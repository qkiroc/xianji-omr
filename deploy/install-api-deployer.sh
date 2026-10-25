#!/usr/bin/env bash
# Install the local-only controller after a successful deployment. Never restart an active job.
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 && $# -eq 2 ]] || exit 2
source_dir=$(realpath -- "$1")
root=/opt/xianji-omr
[[ -f $root/.xianji-omr-managed && -f /etc/xianji-omr/config.json ]] || exit 1
for path in "$root/deployer" "$root/deploy-source.git" "$root/deploy-worktrees" /var/lib/xianji-omr-deploy; do
 [[ ! -L $path ]] || { echo '部署控制器目录不能为符号链接'; exit 1; }
done
if [[ -d $root/deployer && ! -f $root/deployer/.managed ]]; then echo '部署控制器目录已被占用'; exit 1; fi
for name in service socket; do
 unit=/etc/systemd/system/xianji-omr-deploy.$name
 if [[ -e $unit ]] && ! grep -q '^Description=Xianji OMR ' "$unit"; then echo '部署控制器单元名称冲突'; exit 1; fi
done
command -v git >/dev/null || { echo '部署控制器需要Git'; exit 1; }
install -d -m 700 "$root/deployer" "$root/deploy-worktrees" /var/lib/xianji-omr-deploy
touch "$root/deployer/.managed"
if [[ ! -e $root/deploy-source.git ]]; then
 git init --bare --quiet "$root/deploy-source.git"
 remote=https://github.com/qkiroc/xianji-omr.git
 candidate=$(git -C "$2" remote get-url origin 2>/dev/null || true)
 case $candidate in
  https://github.com/qkiroc/xianji-omr|https://github.com/qkiroc/xianji-omr.git|git@github.com:qkiroc/xianji-omr.git) remote=$candidate ;;
 esac
 git --git-dir="$root/deploy-source.git" remote add origin "$remote"
else
 [[ $(git --git-dir="$root/deploy-source.git" rev-parse --is-bare-repository) == true ]] || exit 1
fi
install -m 600 "$source_dir/api-agent.mjs" "$root/deployer/agent.mjs.new"
mv -f -- "$root/deployer/agent.mjs.new" "$root/deployer/agent.mjs"
install -m 644 "$source_dir/xianji-omr-deploy.service" /etc/systemd/system/xianji-omr-deploy.service
install -m 644 "$source_dir/xianji-omr-deploy.socket" /etc/systemd/system/xianji-omr-deploy.socket
systemctl daemon-reload
systemctl enable --now xianji-omr-deploy.socket
echo '本地部署控制器已启用；当前任务不受平台服务重启影响。'
