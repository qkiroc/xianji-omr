# 弦记 OMR 独立 CLI

当前CLI 0.8.0，支持调用平台接口在ECS部署和按类别导出ZIP，新增`deletions preview/execute/list/retry`，永久级联删除替代旧可恢复删除；旧delete/restore接口返回410，需平台schema6。执行必须显式`--acknowledge`。完整stdin/API契约见[永久删除说明](../../docs/permanent-deletion.md)。旧文档中的可恢复删除示例不再适用。

需要Node >=22.18.0。仅Node内置模块，无自定义npm包、无MCP、无需npm install/login。平台必须先升级到包含schema3/CLI授权接口的版本；当前线上旧版本不会因GitHub更新自动升级。

仓库中运行：

```bash
node tools/cli/xianji-omr.mjs --help
node tools/cli/xianji-omr.mjs --version
node tools/cli/xianji-omr.mjs auth --origin http://116.62.12.100:8790 --allow-insecure-http
```

CLI打开外部浏览器，用户在平台登录并点击“授权”。它不输入平台密码，不读取浏览器Cookie；无浏览器时按终端显示地址自行打开，同一台CLI电脑的127.0.0.1回调须可达。`--no-open`禁止自动打开，`--timeout 60`设置等待秒数（1–300）。平台地址必须是origin，不能带路径/query/用户名密码。默认远程HTTPS；上例显式允许HTTP，选择仅保存在该origin。**HTTP明文传输，登录、授权码和Bearer可能被监听或篡改；PKCE不提供加密，也不表示公网部署满足标准OAuth TLS要求。**不支持跳过证书验证。

## 日常命令

下例使用shell变量以免反复填写origin；把ID设为实际JSON返回的值。新建/更新JSON必须有服务端所需字段，更新必须带读取到的version，CLI不会绕过409冲突。

```bash
OMR_ORIGIN=http://116.62.12.100:8790
node tools/cli/xianji-omr.mjs taxonomy --origin "$OMR_ORIGIN"
printf '%s' '{"name":"练习曲集","description":"区域标注"}' | node tools/cli/xianji-omr.mjs datasets create --input - --origin "$OMR_ORIGIN"
node tools/cli/xianji-omr.mjs datasets list --origin "$OMR_ORIGIN"
# DATASET_ID由上一条输出取得
printf '%s' '{"name":"曲目A","songGroupKey":"song-a","split":"train"}' | node tools/cli/xianji-omr.mjs songs create --dataset "$DATASET_ID" --input - --origin "$OMR_ORIGIN"
node tools/cli/xianji-omr.mjs songs list --dataset "$DATASET_ID" --origin "$OMR_ORIGIN"
# SONG_ID由曲目输出取得
node tools/cli/xianji-omr.mjs pages upload --song "$SONG_ID" --file ./score.png --origin "$OMR_ORIGIN"
cat ./score.png | node tools/cli/xianji-omr.mjs pages upload --song "$SONG_ID" --file - --mime image/png --name score.png --origin "$OMR_ORIGIN"
node tools/cli/xianji-omr.mjs pages list --song "$SONG_ID" --origin "$OMR_ORIGIN"
node tools/cli/xianji-omr.mjs pages get "$PAGE_ID" --origin "$OMR_ORIGIN"
node tools/cli/xianji-omr.mjs pages update "$PAGE_ID" --input ./annotation.json --origin "$OMR_ORIGIN"
node tools/cli/xianji-omr.mjs pages content "$PAGE_ID" --original --output ./original.png --origin "$OMR_ORIGIN"
# VERSION必须取当前页面版本；未经这一显式操作不会自动确认
node tools/cli/xianji-omr.mjs pages confirm "$PAGE_ID" --version "$VERSION" --acknowledge --origin "$OMR_ORIGIN"
node tools/cli/xianji-omr.mjs snapshots create --dataset "$DATASET_ID" --origin "$OMR_ORIGIN"
node tools/cli/xianji-omr.mjs snapshots list --dataset "$DATASET_ID" --origin "$OMR_ORIGIN"
# 等ready后，用返回的SNAPSHOT_ID下载，旧快照不必出现在最新30条列表
node tools/cli/xianji-omr.mjs snapshots download "$SNAPSHOT_ID" --kind detection --output ./detection.zip --origin "$OMR_ORIGIN"
node tools/cli/xianji-omr.mjs snapshots download "$SNAPSHOT_ID" --kind crops --output ./crops.zip --origin "$OMR_ORIGIN"
```

annotation.json示例（version须替换当前版本）：

```json
{"version":1,"annotationFormat":"layout-v1","pageType":"music","boxes":[{"id":"line-1","classKey":"system","parentSystemId":null,"readingOrder":0,"x":10,"y":20,"width":500,"height":160},{"id":"tab-1","classKey":"guitar","parentSystemId":"line-1","readingOrder":1,"x":20,"y":40,"width":470,"height":100}]}
```

坐标是工作图整数像素，不包含视图缩放。`annotations save PAGE_ID --input FILE`是pages update别名，仍不确认。`pages normalize PAGE_ID --version N`为旧图建立坐标工作图，旧框保留未归类。`pages unconfirm`显式取消确认。`datasets update`、`songs update`通过--input传完整必需字段和version。兼容旧无类别接口以`legacy images list/upload/get/content/update`提供；不能写新版类别。CLI0.2.0新增分页、软删除/恢复和页序命令，`--help`列出36个业务路由映射；无训练或模型上传命令。

## 凭据与脚本

`auth status`在线核验，`auth status --local`仅显示未在线核验的本地元信息。`auth revoke`撤销当前授权并删除本地记录；网络失败不会显示撤销成功。`auth forget`仅删除本地记录，远端授权可能仍有效。网页“CLI授权”可查看/撤销设备，30天后重新授权；管理员密码变化使旧授权失效。

配置按origin隔离，默认`~/.config/xianji-omr/`（可设XDG_CONFIG_HOME，Windows优先APPDATA），目录0700、文件0600，原子保存；拒绝符号链接和异常POSIX权限。Windows文件mode不能保证等同ACL隔离，需确保用户配置目录仅本人可读，未完成Windows实机验收。不要复制配置给别人或提交Git。没有--token参数，token不打印到终端。

本地Codex/脚本直接调用同一Node入口，无需仓库私有依赖或服务配置；业务stdout一份JSON，进度/错误stderr。退出码：0成功、2参数/输入、3认证、4权限、5冲突、6网络/服务端、7本地文件/完整性、8拒绝/授权超时、130中断。409后人工重新读取合并；不自动重试写请求。文件/stdin输入保持原文件，不会因服务失败删除。下载同目录part流式校验SHA256/长度后无覆盖原子发布，已有目标（含符号链接）拒绝；无哈希或截断不生成成品。拒绝所有HTTP重定向，不泄露Bearer。快照create仅表示接受，不表示ready。

## 离线源码包

维护者在仓库执行 `node tools/package-cli.mjs --output /tmp/xianji-omr-cli-dist`。校验旁置SHA256后解压tar.gz，进入其中目录，直接 `node xianji-omr.mjs --help`，其余命令与仓库入口一致。内含源码、版本、README与文件摘要清单，无node_modules/服务配置/数据；运行时仍需已安装Node和平台网络。仓库未提供开源许可时不自行推断授权条款。

## schema4：歌曲目录、可恢复删除、元信息与页序

这些新命令要求平台升级到schema4，旧命令及授权方式保留。歌曲目录每行一首歌，原图records分页仍兼容，均支持--search/--status/--split/--song/--deleted/--page/--page-size（25/50/100）。歌曲排序为创建时间/ID降序；pages list为歌曲内部页序。

```bash
node tools/cli/xianji-omr.mjs songs catalogue --dataset "$DATASET_ID" --page-size 25 --origin "$OMR_ORIGIN"
node tools/cli/xianji-omr.mjs records list --dataset "$DATASET_ID" --search score --page 1 --origin "$OMR_ORIGIN"
node tools/cli/xianji-omr.mjs records neighbors "$PAGE_ID" --dataset "$DATASET_ID" --origin "$OMR_ORIGIN"
node tools/cli/xianji-omr.mjs pages reorder --song "$SONG_ID" --input ./order.json --origin "$OMR_ORIGIN"
node tools/cli/xianji-omr.mjs songs delete --dataset "$DATASET_ID" --input ./songs.json --origin "$OMR_ORIGIN"
node tools/cli/xianji-omr.mjs songs catalogue --dataset "$DATASET_ID" --deleted deleted --origin "$OMR_ORIGIN"
node tools/cli/xianji-omr.mjs songs restore --dataset "$DATASET_ID" --input ./songs.json --origin "$OMR_ORIGIN"
node tools/cli/xianji-omr.mjs records delete --dataset "$DATASET_ID" --input ./records.json --origin "$OMR_ORIGIN"
node tools/cli/xianji-omr.mjs records restore --dataset "$DATASET_ID" --input ./records.json --origin "$OMR_ORIGIN"
node tools/cli/xianji-omr.mjs datasets delete "$DATASET_ID" --version "$DATASET_VERSION" --origin "$OMR_ORIGIN"
node tools/cli/xianji-omr.mjs datasets list --deleted deleted --origin "$OMR_ORIGIN"
node tools/cli/xianji-omr.mjs datasets restore "$DATASET_ID" --version "$DATASET_VERSION" --origin "$OMR_ORIGIN"
node tools/cli/xianji-omr.mjs snapshots create --dataset "$DATASET_ID" --input ./batch.json --origin "$OMR_ORIGIN"
```

order.json是`{"items":[{"id":"页面UUID","version":当前版本},...]}`，按期望顺序列出歌曲全部未删除页，缺页/重复/跨歌曲/并发变更返回409且不改任何页序；排序不自动确认或取消确认。records.json相同items结构，选择1–100页。songs.json为`{"items":[{"id":"歌曲UUID","version":当前歌曲版本,"pageRevision":"歌曲目录返回的page_revision"}]}`，1–100首；子页任何版本/增删变化都需重读目录，不覆盖冲突。恢复也必须从已删除列表取得新版本。父级恢复不复活先前单独删除子项。batch.json为`{"pageIds":["已确认页UUID",...]}`，每批最多200页，仍校验全数据集同图/曲组跨split；不要因批次另建数据集。

metadata写入使用`annotationFormat:"layout-v2"`。例如一个无谱行父框、明确不夹的完整选区：`{"id":"capo-1","classKey":"capo","parentSystemId":null,"readingOrder":0,"x":10,"y":20,"width":120,"height":30,"metadata":{"scope":"page","rawText":"Capo=0","value":{"fret":0}}}`。metadata.value可省略；tempo可保存`{"scope":"local","rawText":"附点四分音符=72","value":{"bpm":72,"beatUnit":4,"dotted":true}}`。所有六类原文/值透明保存/回读/导出，不从调号猜Capo或将缺省填0。`taxonomy --taxonomy-version layout-v1`可读取旧七类；已存v2的页拒绝v1覆盖。`pages content --thumbnail`可下载已校验PNG缩略图，不能与--original同时使用。

## 裁片检查与逐框复核

原图编辑器“裁片结果”使用当前草稿的精确整数边界；预览不增训练样本。`reviewStatus`由服务端维护，PUT不能自行把框提升成confirmed；geometry/class/metadata/parent/readingOrder变更仅撤回本框的确认，其余保留。逐框确认不等于整页完整性确认，导出仍须pages confirm。

```bash
# review.json: {"version":当前页面版本,"status":"needs_adjustment"}
node tools/cli/xianji-omr.mjs regions review "$PAGE_ID" --region "$REGION_ID" --input ./review.json --origin "$OMR_ORIGIN"
# 确认区域需 {"version":当前版本,"status":"confirmed","acknowledged":true} 及data:confirm
node tools/cli/xianji-omr.mjs regions restore "$PAGE_ID" --region "$REGION_ID" --version "$VERSION" --origin "$OMR_ORIGIN"
```

保存移除的框保留于pages get返回的deletedBoxes（最多5000），restore保留原ID/内容但恢复为draft；不创建副本。历史快照不会被后续复核或删除改写。


## CLI0.3.0 几何定位

新增14个localization命令，全部50模板可检查，原命令保留。完整stdin导入、schema、来源映射、版本锁、显式确认和原生/裁片下载见仓库 [定位契约](../../docs/localization-contract.md)。离线使用者可打开 https://github.com/qkiroc/xianji-omr/blob/main/docs/localization-contract.md 。CLI仅调用平台，不连接OSS/RDS；平台需升级schema5后才有新接口。

谱页 AI 复核：`pages confirm PAGE_UUID --version N --acknowledge --review-type ai`，筛选`records list DATASET_UUID --status ai_reviewed`。默认不带`--review-type`仍是人工确认。AI复核不计入人工确认导出，详见[状态契约](../../docs/ai-review.md)。


## 按类别直接导出 ZIP（CLI 0.5.0）

平台需要部署包含类别导出接口的版本。类别使用 taxonomy 返回的 key，例如 `guitar`（六线谱）、`lyrics`（歌词）、`melody`（简谱）、`system`（完整谱行）、`title`（标题）。

```bash
# 创建冻结快照，等待打包完成，校验SHA256并下载裁片ZIP
node tools/cli/xianji-omr.mjs datasets export "$DATASET_ID" --classes guitar --output ./guitar.zip --origin "$OMR_ORIGIN"

# 多个类别；逗号分隔，可组合全部13种类别
node tools/cli/xianji-omr.mjs datasets export "$DATASET_ID" --classes guitar,lyrics --output ./guitar-lyrics.zip --origin "$OMR_ORIGIN"

# 整页检测ZIP，内含YOLO、COCO和原生标注
node tools/cli/xianji-omr.mjs datasets export "$DATASET_ID" --classes guitar --kind detection --output ./guitar-detection.zip --timeout 900 --origin "$OMR_ORIGIN"
```

默认 `--kind crops`，仅生成所需类型；保留 train/val/test、像素坐标、元信息和来源映射。只选取包含所选类别的已确认页面，草稿、AI复核页、无匹配类别页面不会混入。所选类别的训练ID从0连续编号，COCO从1编号；manifest保存原类别ID。父谱行保存在 `contextBoxes`，不会成为未选类别的训练标签。裁片仍可通过 `sources.json` 找回原图坐标与父谱行。

`--classes`省略时导出全部类别。按类别导出最多5000来源页、100000来源框，普通全类别导出仍最多200页、10000框，单次导出临时文件和ZIP均限制512MB；超限会明确报错，不会截断数据。可用 `--input selection.json` 选择批次，内容例如 `{"pageIds":["PAGE_ID"]}`，亦可在JSON内用 `classKeys`指定类别（和`--classes`二选一）。

默认等待打包900秒，`--timeout`支持1–3600秒。进度与快照ID输出到stderr，stdout只输出最终文件路径、校验值及快照ID。已存在的目标文件会在创建快照前拒绝覆盖。超时或退出后，可查询原快照并继续下载；仅状态为failed的快照可重试，重试不会改变冻结的类别和源标注：

```bash
node tools/cli/xianji-omr.mjs snapshots get "$SNAPSHOT_ID" --origin "$OMR_ORIGIN"
node tools/cli/xianji-omr.mjs snapshots retry "$SNAPSHOT_ID" --origin "$OMR_ORIGIN"
node tools/cli/xianji-omr.mjs snapshots download "$SNAPSHOT_ID" --kind crops --output ./guitar.zip --origin "$OMR_ORIGIN"
```

若需同一冻结数据的检测包与裁片包，继续使用 `snapshots create --dataset "$DATASET_ID" --classes guitar,lyrics`，再分别下载两种ZIP。`snapshots download`不支持临时添加类别筛选，旧快照内容保持不变。`python3 tools/validate-export.py detection.zip crops.zip`可检查同一快照的两种包。

## 通过平台 API 部署（0.7.0，schema9）

本地 CLI 向平台发送 HTTP 请求，ECS 自动拉取本仓库 main，在 ECS 执行 Node/npm 构建、备份、迁移及部署。不需要本机 SSH、Git、私钥或部署包。平台服务仍以 xianji-omr 普通用户运行；独立的本地 systemd 部署控制器执行部署任务，平台自身重启不会中断任务。

### 首次启用一次

当前线上旧代码没有该接口，必须先通过既有部署方式升级到本版本一次。正常 deploy/deploy.sh 成功后自动安装并启用 xianji-omr-deploy.socket 和独立控制器；之后都可通过 CLI 部署。ECS 需要已完成初始配置，root 环境可以非交互拉取本仓库并访问 npm/构建依赖。私有仓库需在 ECS 为 root 配置已有 Git 授权；HTTPS/SSH 仅允许本仓库固定地址，不从 CLI 接收 URL、脚本或 shell 命令。

普通标注授权不会自动获得部署权限。新增独立的 platform:deploy 权限，需重新授权一次，浏览器授权页会显示“拉取main、构建、迁移和重启”的权限说明：

```bash
node tools/cli/xianji-omr.mjs auth --deploy --origin https://omr.example.com
```

如果平台使用远程 HTTP，在首次授权命令上明确添加 --allow-insecure-http；该选择会按origin保存，部署沿用原有授权/HTTPS校验策略。

### 日常使用

```bash
# 发起异步任务，立即返回任务ID
node tools/cli/xianji-omr.mjs platform deploy --origin https://omr.example.com

# 发起并等待完成，显示进度和日志；服务重启时自动恢复查询
node tools/cli/xianji-omr.mjs platform deploy --wait --origin https://omr.example.com

# 查询最新任务及当前运行版本、健康情况
node tools/cli/xianji-omr.mjs platform status --origin https://omr.example.com

# 查询指定任务及日志
node tools/cli/xianji-omr.mjs platform status JOB_UUID --origin https://omr.example.com
node tools/cli/xianji-omr.mjs platform logs JOB_UUID --origin https://omr.example.com
```

平台固定拉取 qkiroc/xianji-omr 的 main，fetch 后冻结 commit，使用独立 worktree，不改动操作者已有检出目录。沿用 --build-on-ecs 的低内存限制（单worker、768MiB RAM、Node堆512MiB、CPU 50%、必要时4GiB临时swap），构建成功后才备份/迁移/切换；内存、磁盘或其他检查不通过则任务失败。

同时只执行一个任务，第二个新任务返回409；重复的同一 requestId 返回原任务，不重复构建。CLI 会在提交前将任务ID写到stderr。网络断线、Ctrl+C或等待超时不会取消ECS任务，也不会自动重发POST，可使用该ID查询；若无法确认请求是否送达，可用 --request-id SAME_UUID 重新提交同一请求。

--wait 默认等待7200秒，--timeout支持1–14400秒。GET查询在平台重启造成网络错误/500/502/503/504时重试，401/403立即停止；任务状态 succeeded 才返回 deployed:true。failed/interrupted 退出码6，任务ID、状态和日志仍可查询。stdout仅最终JSON，进度和脱敏日志在stderr。部署日志只保留最近100行，历史任务最多1000条，达到上限由管理员归档。

### HTTP 接口

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | /api/platform/deployments | JSON仅接受 requestId UUID，返回202和job |
| GET | /api/platform/deployments/latest | 最新job与当前commit/release/health |
| GET | /api/platform/deployments/JOB_UUID | 指定job及最近日志 |

三个接口都要求单独授予 platform:deploy 的CLI Bearer；Cookie、普通标注授权、已撤销或过期授权不能调用。job包含 id、status、phase、commit、createdAt、completedAt、error、logs。状态为 queued/running/succeeded/failed/interrupted。无新任务时 latest 返回 job:null。任务保存在ECS上，与标注数据库/平台重启独立；控制器重启后核对实际commit和健康情况，已部署成功则恢复成功记录，其余标记interrupted，不自动重试部署。数据库不自动回滚；版本不兼容时继续沿用既有部署规则。

0.6.0的SSH上传方案已由此HTTP接口方案替换。离线CLI包同样使用 node xianji-omr.mjs 入口，无需npm安装。

## 按标注任务分组（0.8.0 / schema11）

切图功能可使用 `layout datasets/pages/records/songs/regions/snapshots/annotations ...`；已有无前缀命令仍兼容。切图模型功能使用 `layout training ...` 与 `layout inference ...`，调号数据集和标注使用 `key-signatures datasets ...` 与 `key-signatures records ...`。定位命令继续使用 `localization ...`。运行 `--help` 可列出完整命令。

调号新增：datasets list/create/sync/export、records list/get/update/content/next。创建 JSON 包含 name、sourceDatasetId；保存 JSON 包含 version、tonic、kind（original/play）。列表支持 --status、--tonic、--kind、--search、--split、--page、--page-size。调号图片和导出清单使用 --output 保存，校验 SHA256，并拒绝覆盖文件。

切图模型新增：training runs list/create/get/complete、events list/append、artifacts upload/download，以及 inference workers list/heartbeat、predict、predictions get/image/claim/heartbeat/result。推理使用 --file 图片、--confidence、--iou 和可选的 --request-id；模型文件上传使用 --kind 和 --file。写入型 JSON 命令使用 --input，标注修改必须提供版本。

页面入口调整为切图标注下的三个子 tab，模型页面位于 /layout/training、/layout/models；旧 /training、/models 链接保留跳转。既有训练 worker API 保持兼容。源码仓库的完整流程和输入示例见 docs/key-signature-annotation.md。
拍号标注：与 key-signatures 相同的 datasets list/create/sync/export 和 records list/get/update/content/next 命令均支持 time-signatures 前缀。保存 JSON 使用 version、numerator、denominator，列表支持 --numerator、--denominator；两种标注列表均支持 --trend-days 7/14/30/90 并返回 annotationTrend。数据库需 schema13。
