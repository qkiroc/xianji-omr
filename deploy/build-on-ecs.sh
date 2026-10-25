#!/usr/bin/env bash
# Invoked only by deploy.sh while holding the application deployment lock.
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 && $# -eq 1 ]] || { echo '请通过 sudo bash deploy/deploy.sh --build-on-ecs 调用'; exit 2; }
release=$(realpath -- "$1")
[[ $release == /opt/xianji-omr/releases/* && -f $release/package-lock.json ]] || exit 2
for cmd in systemd-run swapon swapoff mkswap dd df awk mktemp; do
 command -v "$cmd" >/dev/null || { echo "缺少构建工具：$cmd"; exit 1; }
done
available=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
[[ $available -ge 1048576 ]] || { echo '构建前至少需要1GiB可用内存；不会停止其他服务腾内存'; exit 1; }
# Reserve space for 4GiB temporary swap plus dependencies/build output.
free_kb=$(df -Pk "$release" | awk 'END {print $4}')
[[ $free_kb -ge 10485760 ]] || { echo '构建前至少需要10GiB可用磁盘空间'; exit 1; }
swap_file=
unit="xianji-omr-build-$$"
cleanup() {
 rc=$?
 trap - EXIT
 systemctl stop "$unit.service" >/dev/null 2>&1 || true
 if [[ -n $swap_file ]]; then
  if ! swapon --show=NAME --noheadings | awk -v p="$swap_file" '$0 == p {found=1} END {exit !found}'; then
   rm -f -- "$swap_file"
  elif swapoff "$swap_file"; then
   rm -f -- "$swap_file"
  else
   echo "临时swap仍在使用，已保留：$swap_file；稍后 sudo swapoff 此路径成功后再删除。未写入fstab。"
  fi
 fi
 exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
swap_kb=$(awk '/SwapFree:/ {print $2}' /proc/meminfo)
if [[ $swap_kb -lt 4194304 ]]; then
 echo '阶段：创建4GiB临时swap（不改fstab，不停其他服务）'
 swap_file=$(mktemp /opt/xianji-omr/runtime/build-swap.XXXXXXXX)
 # dd allocates real blocks; fallocate can create unsupported swap extents.
 dd if=/dev/zero of="$swap_file" bs=1M count=4096 status=none
 chmod 600 "$swap_file"
 mkswap "$swap_file" >/dev/null
 if ! swapon "$swap_file"; then
  rm -f -- "$swap_file"
  swap_file=
  echo '临时swap启用失败，停止构建；请检查磁盘文件系统/主机权限'
  exit 1
 fi
fi
echo '阶段：受限源码构建（768MiB RAM、512MiB Node堆、单worker、50% CPU；swap可能使构建较慢）'
# MemoryMax maps to memory.limit_in_bytes on cgroup v1, memory.max on v2.
# MemorySwapMax is not relied upon: v1 kernels may not implement swap accounting.
# No unbounded fallback if the transient build unit cannot start.
binding=()
if [[ ${OMR_DEPLOY_API:-} == 1 ]]; then
 binding+=(--property=BindsTo=xianji-omr-deploy.service --property=After=xianji-omr-deploy.service)
fi
systemd-run "${binding[@]}" --quiet --wait --pipe --collect --service-type=exec \
 --unit="$unit" \
 --property=MemoryAccounting=yes --property=MemoryMax=768M \
 --property=CPUAccounting=yes --property=CPUQuota=50% --property=Nice=15 \
 --property=TasksMax=128 --property=KillMode=control-group --property=RuntimeMaxSec=90min \
 --setenv="PATH=$PATH" --setenv=NODE_OPTIONS=--max-old-space-size=512 \
 --setenv=NEXT_TELEMETRY_DISABLED=1 --setenv=CI=1 \
 /bin/bash -c 'set -Eeuo pipefail; cd "$1"; npm ci --omit=dev --ignore-scripts --no-audit --no-fund; npm run build' build "$release"
echo '源码构建成功；后续仍由主部署脚本备份、迁移、切换和健康检查'
