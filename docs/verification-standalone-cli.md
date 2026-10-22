# 独立 CLI 与浏览器授权验收

日期：2026-10-22。基线main：5c463e56cd51a5f8ad0da68e0e66c1797617df4a。执行目录：GPT云端 `/workspace/scratch/82acab135f2b/repository`。本轮实现已完成；最终commit以GitHub main及交付回复为准。

## 实现范围

- tools/cli/xianji-omr.mjs直接Node运行，Node >=22.18.0，仅内置模块，独立版本0.1.0，无npm包/workspace/MCP/发布workflow。现有package.json/package-lock.json未变。
- 平台专用浏览器授权：一次性码、PKCE S256/state、127.0.0.1随机端口、精确路径；cookie-only审批、Bearer业务、scope/有效期/撤销/当前用户与credential hash校验。只存token/code的hash。
- 24规范业务模板全部有命令：taxonomy 1 + datasets 3 + songs 3 + pages 8 + snapshots 4 + legacy images 5。排除网站login/logout/session/health/release；授权生命周期另测。Express实际挂载路由双向比对，并验证注入未映射route确实失败。
- JSON stdout、安全错误stderr、稳定退出码、file/stdin原图字节、version冲突不自动覆盖、显式确认；下载流式part/SHA256/长度/无覆盖原子发布。旧snapshot不在最近30条列表仍可下载。

## 实际执行结果

`PATH=/tmp/omr-pg-tools/bin:$PATH npm test`：**19项通过，0失败，0跳过**；最后一轮约6.5秒。该PATH仅云端测试用PG客户端，不是生产配置。使用隔离PostgreSQL18.1、非超级用户及mock OSS，不写真实云资源。

1. 授权状态机/schema2升3幂等：旧图/坐标版本/会话/ready冻结快照保留；错误PKCE、授权码重放、并发交换单赢家、重复批准、请求/码/token过期、credential失效、scope/Origin/混合身份/重复Authorization、限尺寸/限流、撤销。
2. 真实CLI入口授权：先错误state再合法回调、批准/拒绝/超时/SIGINT，结束后所有listener端口关闭；文件0700/0600，status/revoke；业务--version缺值退出2且修改请求计数为0；独立--version只返回版本JSON。
3. 凭据origin隔离/HTTP选择、锁竞争、权限错误、符号链接拒绝及part/lock清理。
4. 源码入口完整24业务调用：真实子进程对接PG/mock OSS，JSON file/stdin、图片file/stdin、并发保存0/5退出码、显式confirm、legacy上传/读取/更新/normalize、快照create/retry/list及两kind下载，运行既有独立导出校验器。
5. 实际tar.gz解压repo外临时目录，以干净HOME/XDG_CONFIG_HOME、无NODE_PATH/私有配置启动；重跑同一完整24业务真实API流程。模块导入/文件白名单/包内SHA256检查通过，不依赖repo node_modules。
6. 下载错误hash/长度/缺hash/断流/已有目标/符号链接/并发目标/SIGINT清理；128MB生成流下载134217728字节，最后一轮观测RSS增长3121152字节（非普遍上限保证），校验成功。跨origin重定向拒绝，真实HTTPS自签证书拒绝，并禁止NODE_TLS_REJECT_UNAUTHORIZED=0。
7. 有界限流容量回归：2000活跃key后持续18000个新key均拒绝、size保持2000；过期回收后size为1。拒绝来源不会残留在Map。
8. 实际git archive路径归档：隔离临时git检出包含待测代码，执行部署原npm ci参数、npm run build、真实server/src/index.mjs启动，对隔离PG验证schema3/静态授权页/API认证；启动不请求OSS。原有认证/图片故障/备份恢复、发布失败兼容回退、配置隔离、标注/EXIF/快照测试继续通过。

另外实际通过：`npm run build`、`python3 test/config-pty.py`、`bash -n deploy/deploy.sh deploy/bootstrap.sh`、`git diff --check`。systemd AF_NETLINK保留，服务端无运行时tools/cli导入，根npm依赖及部署归档边界保持。

## 实际云端浏览器

在内部临时预览terminal.local:4173、隔离合成账号会话中实际打开授权页，显示客户端/设备、请求scope、30天有效期及HTTP明文风险，点击批准和拒绝；查询隔离DB分别为approved/denied。已签发的隔离测试grant在网页点击撤销后显示“已撤销”，数据库revoked_at非空。未替真实生产用户批准。

发现并修复原生表单的真实问题：no-referrer使浏览器POST带Origin:null被正确拒绝；授权页改same-origin引用策略（响应头及meta），同源审批保留Origin，跨源回环不带Referer；decision响应仍no-referrer。修复后实际点击落库验证通过，没有放松Origin检查。

原工作台回归：打开800×1000合成图，原生键盘步进修改框x至66，保存为v4，退出重开仍x66/y200/w680/h200且草稿未确认。工具的fill未触发原生change，首次观察未变化，改用真实键盘步骤验证；未把仅DOM值改变当保存成功。

截图在本任务：`/workspace/scratch/standalone-cli-authorize.jpg`、`standalone-cli-revoked.jpg`、`standalone-cli-workbench.jpg`；不含token、code、verifier。

边界：浏览器和CLI分属容器；本次手工浏览器审批使用隔离测试回调，只验证页面、原生提交、拒绝及落库，**未宣称完整浏览器直达CLI回环换码通过**。完整CLI回环/换码通过实际入口+HTTP审批集成验证，后者不是浏览器实测。浏览器凭据输入未人工重复测试，使用既有fixture临时会话；真实网页登录API在集成测试覆盖。没有在Windows/macOS实机测试OS浏览器打开器/ACL；源码有对应打开器路径，不能宣称跨系统已实测。生产没有测试后门；test辅助脚本不会进入部署归档。

## 离线交付

生成命令：`node tools/package-cli.mjs --output /workspace/scratch/xianji-omr-cli-delivery`。

文件：`/workspace/scratch/xianji-omr-cli-delivery/xianji-omr-cli-0.1.0.tar.gz`；SHA256：

```
0178eb5f9c40968198cc4be90e18fa84785b299e1f0d777dc17fa9fe1e39f0ce
```

包只含CLI源码、README、manifest及文件摘要；旁置.sha256为整包校验。解压后直接`node xianji-omr.mjs --help`，不运行npm安装。无许可时不擅自增加开源授权。

## 生产与升级限制

本轮没有连接/部署ECS、真实OSS/RDS或修改弦记8787，也没有配置证书。生产不会因GitHub推送自动更新。用户在已有ECS仓库执行：

```bash
git pull --ff-only
sudo bash deploy/deploy.sh
```

003新增授权表，迁移前沿用备份/锁；schema3不能由schema2旧代码回退写库。升级后才有新授权API。当前http://116.62.12.100:8790必须显式--allow-insecure-http，选择按origin保存；HTTP不加密、PKCE不替代HTTPS，不宣称标准OAuth公网TLS合规。ECS/RAM/OSS/RDS全链路及本地桌面浏览器回环仍需后续真实环境联调。
