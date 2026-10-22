#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo '请执行 sudo bash deploy/deploy.sh'; exit 1; }
source /etc/os-release
[[ $ID == alinux && $VERSION_ID == 3* && -d /run/systemd/system ]] || { echo '仅支持 Alibaba Cloud Linux 3 + systemd'; exit 1; }
repo=$(git -C "$(dirname "${BASH_SOURCE[0]}")/.." rev-parse --show-toplevel)
git -C "$repo" diff --quiet HEAD && [[ -z $(git -C "$repo" ls-files --others --exclude-standard) ]] || { echo '源码有未提交修改，请先核对；不会重置源码'; exit 1; }
root=/opt/xianji-omr
for p in "$root" /etc/xianji-omr /var/backups/xianji-omr /var/log/xianji-omr-deploy; do
 [[ ! -L $p ]] || { echo '部署路径不能是软链接'; exit 1; }
 if [[ -d $p && ! -f $root/.xianji-omr-managed && -n $(ls -A "$p") ]]; then echo '路径已有非本应用内容，停止'; exit 1; fi
done
if [[ -e /etc/systemd/system/xianji-omr.service ]] && ! grep -q '^Description=Xianji OMR image annotation API$' /etc/systemd/system/xianji-omr.service; then echo '服务名冲突'; exit 1; fi
install -d -m 755 "$root"
exec 9>"$root/deploy.lock"
flock -n 9 || { echo '另一部署正在进行'; exit 1; }
touch "$root/.xianji-omr-managed"
install -d -m 755 "$root/releases" "$root/runtime"
install -d -m 700 /var/backups/xianji-omr /var/log/xianji-omr-deploy
log=/var/log/xianji-omr-deploy/$(date -u +%Y%m%dT%H%M%SZ)-$$.log
exec > >(tee -a "$log") 2>&1
trap 'echo "部署失败，查看脱敏阶段日志。没有自动恢复/重置数据库。"' ERR
echo '阶段：运行依赖核验/安装（仅客户端，不安装本机数据库）'
bash "$repo/deploy/bootstrap.sh"
export PATH="$root/runtime/node/bin:$root/runtime/postgresql/bin:/usr/sbin:/usr/bin:/sbin:/bin"
if ! id xianji-omr >/dev/null 2>&1; then useradd --system --home-dir /nonexistent --shell /sbin/nologin xianji-omr; fi
[[ $(id -u xianji-omr) -ne 0 ]]
version=$(date -u +%Y%m%dT%H%M%SZ)-$(git -C "$repo" rev-parse --short=12 HEAD)-$$
release=$root/releases/$version
mkdir -m 755 "$release"
git -C "$repo" archive HEAD package.json package-lock.json web server deploy | tar -xf - -C "$release"
echo '阶段：安装锁定依赖、构建同源网页/API'
(cd "$release" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm run build)
printf '%s\n' "$version" > "$release/server/RELEASE"
chmod -R a+rX "$release"
echo '阶段：首次私密配置或复用配置（提示直接显示在终端，密码隐藏）'
node "$release/server/setup-config.mjs" </dev/tty >/dev/tty 2>/dev/tty
# preflight validates port ownership before any service unit replacement/migration.
node "$release/server/deploy.mjs" "$release" --preflight
install -m 644 "$release/deploy/xianji-omr.service" /etc/systemd/system/xianji-omr.service
systemctl daemon-reload
echo '阶段：数据库部署锁、备份、幂等迁移、原子切换与健康检查'
node "$release/server/deploy.mjs" "$release"
systemctl enable xianji-omr.service
echo '部署成功。访问地址以 /etc/xianji-omr/config.json 中 origin 为准。未改防火墙/安全组/白名单。'
