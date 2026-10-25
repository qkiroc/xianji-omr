# ECS 一键部署（独立 xianji-omr）

> 当前为schema8（新增人工审核日期记录；历史非合成确认页以更新时间回填为估算，不改原标注内容），删除语义已改为不可恢复级联清理。升级前核对新增OSS版本查询/删除权限；见[永久删除说明](../docs/permanent-deletion.md)。以下旧schema/软删除章节仅为历史说明，恢复入口及相关旧接口已停用。升级不自动清空历史回收数据。

## 本地 CLI 升级（无需进入 ECS 终端）

ECS 已完成首次配置后，可在 Windows/macOS/Linux 本机通过 SSH 密钥发起升级：

```bash
node tools/cli/xianji-omr.mjs platform deploy --host omr-ecs --artifact ./release.tar.gz
node tools/cli/xianji-omr.mjs platform status --host omr-ecs
```

`omr-ecs` 是本机 SSH config 别名，也可填写 `root@ECS地址`。需要已核验的主机指纹、密钥/agent，以及 root 或免密 sudo。部署包及旁置 SHA256 来自 GitHub Actions 的 **Build ECS release package** 附件；不需要ECS拉取源码或本地npm安装。CLI自动双端校验、上传和执行既有备份/迁移/健康检查流程。`--dry-run`可仅校验本地包。完整参数、首次准备和断线处理见 [CLI说明](../tools/cli/README.md#从本地-cli-部署平台060)。

部署脚本增加 `--artifact FILE --sha256 SHA --commit COMMIT --non-interactive`，用于CLI上传的独立暂存目录：commit必须匹配包内清单；无需Git检出，必须已有应用托管标记和配置，缺失即停止。手工源码构建及原有产物部署方式继续可用。

## ECS 单行源码构建部署

已有仓库目录中执行：

```bash
git pull --ff-only && sudo bash deploy/deploy.sh --build-on-ecs
```

不需要下载预构建包。本参数替代默认产物模式；保留 `--artifact` 和高内存 `--build-from-source` 兼容。
新安装先 `git clone https://github.com/qkiroc/xianji-omr.git && cd xianji-omr`，再执行上面命令；首次仍按下文准备独立库/OSS权限并在终端私密输入配置。

针对约1.8GiB内存的ECS：构建前检查至少1GiB可用内存、10GiB可用磁盘；可用swap不足4GiB时创建应用专用4GiB临时swap，不写fstab。systemd临时构建单元限制RAM 768MiB、Node堆512MiB、CPU 50%、单Next worker、90分钟超时。安装锁定生产依赖后顺序类型检查与构建；不会因构建失败停止已有应用或进入迁移。配置、备份、迁移、原子切换和健康检查沿用原流程，不操作弦记8787。系统或文件系统不支持swap/systemd限制时明确失败，不无约束重试。swap会增加磁盘IO、可能影响同机延迟，构建时间可能很长，不能保证小内存机器一定构建成功或其他服务完全无性能波动。

结束时停止临时构建单元并清理本次swap；swapoff失败则保留文件和启用状态、输出路径，待可用内存恢复后手动swapoff成功再删除，绝不直接删除仍启用的swap。不会清理已有swap。

**本次新增脚本的验证状态：云端执行环境离线，已做代码自审，但尚未运行bash语法检查/受限构建或ECS实测。先前35项测试与Node22预构建验收不覆盖本次脚本改动。** 首次执行遇到内存/工具问题应停止诊断，不能把资源限制移除后盲目重试。以下历史产物模式仍可选，提及“必须预构建”的内容仅适用于未使用本参数时。

适用于 Alibaba Cloud Linux 3、x86_64、systemd。Node 22.18+（22系列），Next.js App Router + TypeScript API，同源提供；默认8790，禁止8787。脚本不会连接旧服务或读取旧配置，不安装本地生产数据库，不修改防火墙、安全组、RDS白名单、Bucket/CORS/ACL，不创建计费实例。

## 先准备一次

1. 在现有 PostgreSQL 18 RDS 控制台创建普通账号 **xianji_omr**（非超级用户），创建独立数据库 **xianji_omr**，授权该账号为数据库 owner/建表读写。不要使用 ai_fiction、xianji 或它们的账号。控制台若不能设置 owner，请用已有数据库管理员在管理工具中执行以下独立初始化（不是日常部署）：

   ```sql
   -- 账号密码在控制台安全设置，不在共享终端/脚本/Git里写密码。
   -- 账号必须已由控制台创建；下列语句各自独立执行，CREATE DATABASE不能在事务内运行。
   CREATE DATABASE xianji_omr OWNER xianji_omr;
   -- 连接到新建的 xianji_omr 后：
   GRANT USAGE, CREATE ON SCHEMA public TO xianji_omr;
   ```

   如控制台已经创建了该数据库，不重复 CREATE DATABASE；管理员核对 owner 为专用账号即可。服务和迁移均使用普通账号，绝不要求超级用户。已有库/表不变。首次迁移拒绝包含未知 public 表的数据库。
2. 核对 ECS 到 RDS 网络可达。默认内网 `pgm-2ze5en6164xx9e2l.pg.rds.aliyuncs.com:5432`；不同地域/VPC不保证互通，必要时显式配置已存在外网 `pgm-2ze5en6164xx9e2lco.pg.rds.aliyuncs.com:5432`，白名单由你按现有网络策略管理。数据库默认 TLS verify-full；准备可信 RDS CA 文件，root 所有、服务组可读不可写（0640），或使用已被系统信任的 CA。只有你明确选 disable 才关闭 DB TLS。
3. 保持现有私有 Bucket `xianji-source`（北京）及禁止公共访问。为 ECS 绑定已有最小权限 RAM Role（推荐），或准备仅限应用前缀的凭据。对象默认使用 `omr/`，只能配置其子前缀。最小对象权限为 `oss:PutObject`、`oss:GetObject`、`oss:DeleteObject`，Resource 为 `acs:oss:*:*:xianji-source/omr/*`（如使用子前缀可进一步收紧）。DeleteObject 只用于上传后数据库失败的补偿，业务软删除不删除OSS对象；不需要 ListBucket/PutBucketAcl/PutObjectAcl 或 CORS 修改。RAM Role 自动发现/可指定名称，凭据由官方 SDK 获取并更新；也支持 STS/AK。手工 STS 到期需由管理员在受限配置更新，长期服务优先 RAM Role。
4. 确定网页访问 Origin（协议+主机+端口，不含路径，例如 `https://omr.example.com`）。生产建议在已有 HTTPS 反向代理后使用 `127.0.0.1:8790`，正确保留同源 Host/Origin；脚本不自动安装证书或修改现有代理。直接 HTTP 访问可显式配置 `http://ECS地址:8790` + `0.0.0.0`，Cookie不带Secure；此方式登录与图片会明文传输。不要把示例域名照抄为实际配置。

本版部署命令必须先设置 `OMR_ARTIFACT`（已传到ECS的预构建包绝对路径）和 `OMR_SHA256`（本任务交付的64位校验值），见末节。不提供时直接停止，不会悄悄改成源码构建。

## 首次部署

需要 sudo、Git、出站访问官方 Node/PostgreSQL HTTPS 源及 npm，建议4GB以上可用磁盘。ECS Git 拉取授权由你已有GitHub方式完成；本脚本不读取SSH私钥或配置Git授权。

```bash
git clone --branch main https://github.com/qkiroc/xianji-omr.git
cd xianji-omr
sudo bash deploy/deploy.sh --artifact "$OMR_ARTIFACT" --sha256 "$OMR_SHA256"
```

首次依次配置：RDS主机/端口、专用账号密码、TLS/CA、管理员用户名/密码确认、监听地址/端口、网页 Origin、OSS Bucket/Region/Endpoint/前缀/认证模式，以及RAM Role名称（可空）或OSS凭据。数据库名及账号固定为 xianji_omr。数据库密码、管理员密码、AK ID/Secret、STS token均隐藏输入，无历史、不进入部署日志；不要一次粘贴多行。Ctrl+C/EOF安全取消，不发布半份配置。

配置保存在 `/etc/xianji-omr/config.json`（root:xianji-omr 0640，目录0750），不在仓库。管理员密码只存scrypt派生值；DB/OSS凭据必须受限保存以便服务连接。后续自动校验复用，不再次询问。管理员需手动更新配置时先做受限副本，再执行同一部署命令；不要打印或上传配置。CA文件可放同目录，服务组只读。

默认OSS内网 `https://oss-cn-beijing-internal.aliyuncs.com`；外网可改 `https://oss-cn-beijing.aliyuncs.com`。服务器通过认证后端代理原图，不存永久签名URL，不把凭据发送给前端。

## 更新

```bash
cd xianji-omr
git pull --ff-only
sudo bash deploy/deploy.sh --artifact "$OMR_ARTIFACT" --sha256 "$OMR_SHA256"
```

拉取冲突时先人工核对，不强制reset/push。部署要求干净的已提交源码（忽略node_modules/构建输出），只使用当前HEAD，重复执行不会重放已完成迁移，不删除标注数据。

流程：OS/路径冲突检查 → flock部署锁 → 官方HTTPS下载并SHA256核验Node和PG18客户端（仅缺失时安装）→ 校验云端预构建包/安全解压到独立release → 私密配置 → 端口归属核验 → PostgreSQL advisory lock → 专用库/非超级用户/PG18/迁移历史校验 → 全库custom备份及pg_restore格式校验/SHA256 → 版本化事务迁移 → 原子current链接切换/systemd重启 → API/schema/release/网页健康检查 → 开机启动。

Node客户端安装在应用自身runtime，不覆盖系统Node。PG客户端由官方18.1源码构建，顺序为generated-headers → libpq → pg_dump/restore，不安装/启动PostgreSQL服务；首次编译可能几分钟。校验/备份/迁移任何失败均停止。已经应用的迁移校验和不可改；未知schema拒绝部署和启动。以后迁移只允许expand，新增版本须更新compatibility与SCHEMA并测试；不支持自动破坏性迁移。PG18客户端可连接同major的18.0 RDS。

健康检查失败：仅在旧release兼容当前schema时切回旧代码并重查；否则停服。没有旧版本时停服。绝不drop/reset/down或用备份覆盖数据库。重启有短暂中断，不是零停机。发布失败保留release/备份供诊断，不自动清理旧版本。部署锁覆盖备份至健康检查；数据库账号池max=3（部署时另有备份连接，仍低于20），API查询超时15s。

路径/服务：

| 用途 | 位置 |
|---|---|
| systemd服务 | xianji-omr.service |
| 程序/版本 | /opt/xianji-omr/releases/、current软链接 |
| 运行依赖 | /opt/xianji-omr/runtime/ |
| 配置 | /etc/xianji-omr/config.json |
| 迁移前备份 | /var/backups/xianji-omr/*.dump、*.sha256 |
| 部署日志 | /var/log/xianji-omr-deploy/（root可读） |
| API日志 | sudo journalctl -u xianji-omr.service |

服务以非root xianji-omr运行，ProtectSystem=strict、NoNewPrivileges、私有临时目录；服务不可写release/配置。若端口已有其他进程、current不是本应用release软链接、目录已有不属于本应用的内容、同名服务被其他应用占用，则停止；不会占用8787。首次目录冲突处理前请人工确认，不删除他人文件。

故障阶段记录不含原始数据库/OSS错误、请求体、密码或token。不得启用bash -x。迁移前备份包含标注、元信息和会话，但**不包含OSS原图**；自行安排私有备份、OSS版本/生命周期/异地副本，脚本不会修改这些策略。Bucket默认低频存储可能产生读取/最短保存周期等费用，本任务未改变存储类别。

备份格式校验不等于生产恢复演练。本项目隔离测试做过真实pg_restore恢复并比对标注。生产恢复须由管理员另建专用恢复库、核对SHA256并pg_restore --single-transaction，验证后再制定切换方案；禁止对当前线上库使用--clean或覆盖恢复。

## 验收与范围

本任务没有登录/部署ECS、没有访问真实OSS/RDS。通过的是云端隔离PostgreSQL18.1 + mock OSS测试、浏览器流程及脚本静态检查；Alibaba Cloud Linux 3工具链安装、systemd实际启动、RAM Role/STS/AK、TLS与真实网络均需首次ECS执行后验收。部署成功健康检查只证明同源网页与数据库schema可用；首次上传/保存/刷新/重新打开图片才验证OSS/RDS全链路。

上传最大20MB、边长20000、5000万像素，PNG/JPEG/WebP静态图（不支持动画），最多5000框/图；数据集工作台按曲目打开多页原图。单管理员，无公开注册。未保存修改仅在当前页面内存，不写入浏览器IndexedDB，服务端确认后才显示云端已保存；409不覆盖，导出备份后从图片库打开最新版本。上传OSS失败不写DB；DB失败尽力删除本次对象，清理失败记安全对象ID供管理员核对，极端断电可能留孤立对象，不会伪报已保存。业务删除仅为可恢复状态，不永久删除原图。

## 从已有切图工具升级到数据集平台

在现有仓库目录执行（不改现有配置或 OSS/RDS 资源）：

```bash
git pull --ff-only
sudo bash deploy/deploy.sh --artifact "$OMR_ARTIFACT" --sha256 "$OMR_SHA256"
```

本轮 schema 2 使用版本化迁移 002，保留原有图片 ID、对象 key、坐标、版本和登录会话。旧图片进入“历史待整理”曲目，保持 legacy 草稿，不自动确认、不自动作为训练数据。用户需创建明确曲目/分组，逐页转换、归类并确认；浏览器原有未保存草稿不会被删除。新版保存拒绝旧客户端无类别覆盖。

迁移前脚本照常备份并校验；迁移失败不启动新版。schema 1 旧程序不兼容 schema 2，健康检查失败时不能回退到旧 schema 1 release，脚本会停服保留备份，禁止手工用旧程序写新版数据库。后续 schema 2 兼容版本仍按原有健康检查与回退流程执行。AF_NETLINK 的 systemd 修复保留。冻结快照在私有 OSS omr/ 前缀下存储两个导出包，服务端认证下载；账号须具有该前缀原有读写权限。不要把服务配置设为超级用户。

本轮没有连接生产 ECS、真实 OSS 或 RDS；此前已上线服务的状态不由本轮测试推断。升级后需在 ECS 实际验证上传、保存、重开、确认和导出。训练、模型上传和识谱不在本轮范围。

## 独立 CLI 授权升级（schema 3）

在现有仓库执行 `git pull --ff-only` 后 `sudo bash deploy/deploy.sh --artifact "$OMR_ARTIFACT" --sha256 "$OMR_SHA256"`。003仅新增CLI授权请求与grant表/索引，保留原图、标注、快照及网站会话；凭证只存hash。迁移前备份与部署锁沿用；失败不重置数据库。schema2旧release不兼容schema3，禁止手工回退旧代码写库。AF_NETLINK保留，不修改8787或既有配置。

生产归档仍为package.json/package-lock.json/web/server/deploy，无workspaces或CLI依赖；授权网页/API随原归档发布，本地CLI不需安装在ECS。现有HTTP origin可显式允许，无需本轮配置证书，但不能视为加密传输或标准OAuth公网TLS部署。只有部署本版本后CLI浏览器授权才可用。本轮仅隔离PG/mock OSS测试，未部署生产。

## 数据集/歌曲目录及元信息升级（schema 4）

现有安装执行同一命令：`git pull --ff-only`，然后`sudo bash deploy/deploy.sh --artifact "$OMR_ARTIFACT" --sha256 "$OMR_SHA256"`。004是增量迁移，新增数据集/歌曲/谱页独立deleted_at、图片source/annotation_version/deleted_boxes及索引；不改旧SQL校验和、不重写原七类ID/框/对象，不删除现有会话或CLI授权，不重写已冻结包。schema3数据和授权升4且重复迁移已在隔离PG18验证。

迁移前备份照常执行。旧schema3 release的声明不兼容schema4；健康检查失败不能回退运行旧程序写新库，脚本按兼容策略停止并保留备份/release，禁止手动reset/drop/覆盖库。AF_NETLINK与独立端口8790保留，不改8787服务或访问控制。此次没有操作生产；真实OSS/RDS和systemd须由ECS升级后验收。

删除与恢复只改数据库状态及版本，父数据集/歌曲不可用时其页面内容、读写、上传、确认和新快照均拒绝。恢复父级不恢复先前独立删除的子项。原OSS对象与历史冻结包保留，旧包仍可认证下载，后续新快照只选活跃确认页。新歌曲表服务端分页，不改变曲目级split隔离；编辑器左侧拖拽页序为原子乐观锁操作，不修改框内容和确认状态。schema4当前仅允许新版程序运行。

裁片检查视图无需新增服务或OSS权限。004的deleted_boxes保留已移除区域；框复核状态随boxes保存，旧类别/快照保持解释。网页复核与CLI接口继续走既有会话/Bearer scope，不新增密码、公开链接或外部服务。


## schema5 / Next.js 与低内存部署包（当前部署方式）

ECS约1.8GiB内存，默认**不执行npm install或next build**。先在电脑下载本任务交付的Linux x64/Node22 tar.gz及SHA256文件，再通过你的正常文件传输方式放到ECS，例如 `/var/tmp/xianji-omr-release.tar.gz`。不要在聊天中传配置和密钥。预构建包与源码main的commit必须完全一致；不要将其他版本包用于当前checkout。

```bash
cd /你的检出路径/xianji-omr
git pull --ff-only
export OMR_ARTIFACT=/var/tmp/xianji-omr-release.tar.gz
# 填交付时公布的64位校验值；它不是凭据
export OMR_SHA256=交付的SHA256
sudo bash deploy/deploy.sh --artifact "$OMR_ARTIFACT" --sha256 "$OMR_SHA256"
```

首次仍需要专用库/账号、已有OSS授权以及交互终端私密配置，见本文件前文。升级复用 `/etc/xianji-omr/config.json`，先全库备份，再005增量迁移；原切图、确认页、CLI授权、回收站、冻结快照不重写。schema4旧代码不支持schema5，健康失败只回退兼容schema5的release，否则停止新服务保留备份/数据，不能把旧代码强行启动写库。未操作弦记8787。

预构建包包含 `.next`生产输出（含standalone追踪输出和静态块）、锁定生产node_modules、TS API/迁移、应用源码和部署文件；Next standalone默认生成的server.js不承载本项目认证API，因此通过同包的`server/src/index.mjs`自定义同源入口运行。无需另开端口。含sharp Linux x64原生依赖，目标glibc>=2.26；不是arm64包，不包含Node二进制，bootstrap只在缺失时核验/安装独立Node22与PG18备份客户端。服务MemoryMax512M、Node heap256M，未在真实ECS压测，不保证极端并发不会触发限额；上传和导出按已有资源限制串行/受限进行。

开发者仅在云端有足够内存的干净commit上执行：

```bash
npm ci
node deploy/build-artifact.mjs /云端交付目录
# 该命令要求当前node为Linux x64 Node22，拒绝未提交源码
```

产物生成后必须使用同一Node22在隔离PG/mock OSS运行归档启动验收，并提供SHA256。包不含任何配置、凭证、测试fixture、真实图片、标注、模型或node_modules中的embedded-postgres测试依赖。生产不从包外读取旧服务配置。源码构建只对明确传`--build-from-source`且至少3GiB可用内存开放，不适用于当前小内存ECS。
