# 切图标注 · xianji-omr

当前 schema15 / CLI0.10.0。编辑器中的删除属于标注 JSON 编辑，保存前可撤销、重做；删除数据集、谱页或导出快照时按影响范围清理数据库与相关文件，详见[数据清理说明](docs/permanent-deletion.md)。

谱页新增独立[AI复核状态](docs/ai-review.md)，不等于人工确认、不计入确认训练数据。

中文数据集管理与原图区域标注平台。支持数据集、曲目、多页页序、明确 songGroupKey 和曲目级 train/val/test；原七类及六类元信息整数像素框、父子谱行、裁片预览、撤销重做、草稿与人工确认。仅确认数据可冻结不可变快照，导出整页 YOLO/COCO/原生标注包及裁片来源映射包。训练在平台之外进行，本轮不含训练器、模型上传或自动识谱。

生产：Next.js App Router + React + TypeScript strict，Node22.18+同源网页/API，私有OSS存原图，PostgreSQL18存元信息/坐标/版本与会话；浏览器未保存修改只在当前页面内存，不自动写入本地存储。请按 [ECS部署说明](deploy/README.md) 首次配置并使用匹配commit的云端预构建包运行 `sudo bash deploy/deploy.sh --artifact /包路径 --sha256 校验值`（小内存ECS不运行next build）。

## 云端隔离开发/验证

```bash
npm ci
npm run build
# PATH中需有PG18的pg_dump/pg_restore（测试会真实备份恢复）
npm test
python3 test/config-pty.py
bash -n deploy/deploy.sh deploy/bootstrap.sh
# 独立隔离PG+内存对象存储，切勿作为生产入口
npm run dev
```

开发预览使用`npm run build`生成的最新页面，默认4173，Origin为`http://terminal.local:4173`（云端QA）。如自行在开发机用回环地址启动，可修改test/preview.mjs的origin为实际地址。测试预览可访问`/__test-login`进入一次性模拟会话；此路由**仅存在于test fixture**，生产app及部署归档不包含test目录，生产只支持真实管理员登录。测试用户名/密码是固定虚构值，仅适用于隔离测试。

测试使用npm锁定的embedded-postgres PostgreSQL18.1二进制，端口55440（集成）、55439（预览），回环监听，随机临时目录/独立库，mock OSS不连接阿里云。Linux x64环境验证。非root正常运行；本Work云端仅映射UID0且禁止Unix socket，fixture在临时目录编译**仅测试使用**UID/stat兼容库，只注入隔离PG子进程，以TCP回环运行，不修改系统安全策略，也不进入生产包。需要gcc；不要将test fixture用于公网或生产。

本页备份 JSON schemaVersion=2，包含工作图 dataUrl、图片元信息及 layout-v2 boxes（classKey、parentSystemId、readingOrder、x/y/width/height、可选metadata）。包含dataUrl的备份导入创建新页面并保存为未确认草稿，不覆盖原记录；不含图片的标注JSON只能应用到相同原图ID的内存编辑，仍需保存。兼容旧无类别 JSON，但保留为未归类草稿，不自动成为训练真值。旧浏览器存储原记录未清除，新版不再读取或写入。数据库不存图片二进制或永久签名 URL。

快照逐图处理并校验图片哈希；相同原图跨 split、同曲组跨 split 或同图不同标注拒绝导出。同图同 split 且标注等价才去重，并保留来源映射。快照后编辑不会更改既有导出。类别版本 layout-v1：0 system、1 guitar、2 melody、3 lyrics、4 chord_marks、5 staff_notation、6 other_tab（COCO id 为 1–7）。标签只表达区域定位，不提供音符/歌词内容真值。

每次快照最多200来源页/10000来源框，单页最多5000框，临时数据文件合计512MB、每个ZIP最多512MB；单个导出任务串行运行，请预留至少2GB临时磁盘。裁片总像素每页不超过2亿。超过限制通过CLI snapshots create --input选择同数据集内一批确认页（pageIds），不拆分数据集；导出失败保留冻结清单，可重试。校验下载包：`python3 tools/validate-export.py detection.zip crops.zip`。

快捷键：V选择、R画框、H平移、空格/中键拖动平移、普通滚轮平移、Ctrl/⌘滚轮围绕鼠标缩放、Delete删除、Ctrl/⌘Z撤销、Shift+Ctrl/⌘Z重做。拖拽结束形成一次撤销记录。视图调整不进入标注撤销历史；刷新/重新打开会重置内存撤销栈，已保存标注从服务端恢复，未保存修改仅在当前页面。

生产源文件为app/、components/、shared/、server/src/*.ts与deploy/；真实Next App Router pathname页面，同源TS API，mjs薄入口保留既有调用。web/仅作旧兼容测试素材，生产不加载旧app.js。没有外部CDN或前端密钥。GitHub Actions 只执行测试、生产构建及隔离浏览器验收，不自动部署 ECS。

## 独立 CLI（平台升级后使用）

[完整用法与离线分发](tools/cli/README.md)。仅需Node >=22.18.0，无自定义npm包、workspace或MCP。

```bash
node tools/cli/xianji-omr.mjs --version
node tools/cli/xianji-omr.mjs auth --origin http://116.62.12.100:8790 --allow-insecure-http
```

浏览器登录后明确批准，凭证按origin隔离，可在网页“CLI授权”撤销。HTTP是明文传输，PKCE不替代HTTPS。当前平台须先升级到schema3才有授权接口；推送GitHub不会自动更新ECS。原服务依赖/构建仍使用现有npm命令。

## 谱页标注与复核工作流

切图任务首页为数据集卡片。数据集内按单张谱页分页展示，序号为这张谱页在所属歌曲中的 `pageOrder`，显示“第 N 页”。状态和集合筛选即时生效；搜索支持歌曲、文件名和来源，批量选择与行操作不会打开编辑器。

进入编辑器后，顶部显示歌曲、页码、处理队列、上一页、下一页、保存及确认操作，画布工具与页面操作分开。点击“确认并下一页”会先保存，再人工确认，随后进入同一状态队列的下一张谱页，保留搜索、集合与歌曲条件。AI 复核队列不会混入草稿；没有其他匹配页面时留在当前页并提示完成。“上一页”优先返回实际访问过的谱页，已确认而离开原筛选的页面仍可回看。返回列表保留筛选和列表页码，直接 URL 与刷新恢复上下文。详见[单页工作流](docs/page-annotation-workflow.md)。

区域和定位小节在编辑器中直接删除，不弹确认、不请求数据清理接口。删除、移动和改属性共用本次未保存编辑的撤销/重做历史；撤销到保存时的内容会恢复“已保存”状态。保存成功建立新的编辑起点；保存失败保留修改和撤销历史，确认失败不跳页。保存只更新标注 JSON，不修改原图、原始定位附件或已有冻结快照。

数据集、歌曲、原图、定位记录及快照的删除仍先确认影响范围，再清理数据库与相关对象；不提供回收站恢复。来源页的删除可能影响引用该页的定位数据和导出快照，确认框展示非零影响数量。清理失败可通过待完成任务重试。

layout-v2在原ID0–6后追加7标题、8歌手/演唱者、9拍号、10调号、11速度/BPM、12变调夹（COCO8–13），旧数据/模型/快照ID不重排。选区画完整字段区域，原文和结构化值均可空；页级框无需完整谱行父框，拍号/调号/速度可标曲中局部变化及可选谱行。Capo=0明确不夹，未填写不等于0；BPM保留拍单位/附点，速度词可只有原文。标题/演唱者只属于实际出现的曲目/谱本页，不向其他页复制。六类内容由native/COCO扩展字段及裁片映射保留，YOLO只提供区域定位。

当前数据库为 schema7；本轮编辑与翻页改动不需要新增迁移。CLI 和历史迁移说明见[CLI说明](tools/cli/README.md)及既有验收记录。

编辑器支持“原图标注 / 裁片预览”，共享当前草稿。裁片使用区域的整数边界，不额外补边；标题、变调夹、拍号和调号可并排，其余裁片各占一行。点击裁片回到原图定位选区。选中区域时，右侧仅展示该选区属性；取消选择后展示添加类别、区域列表与页面设置。

按用户后续要求，已停用浏览器IndexedDB草稿存储和首页恢复入口。保存写入服务端，未保存修改只在当前页面；站内离开提供保存/放弃提醒，刷新或关闭有浏览器提醒。服务器保存失败/版本冲突不离开或伪报成功。旧浏览器草稿存储不自动清空；JSON导出仅在用户主动点击时执行。


## schema5 几何定位与稳定URL

见[定位API/CLI完整契约](docs/localization-contract.md)、[导入JSON Schema](docs/localization-import.schema.json)、[验收记录与限制](docs/localization-next-acceptance.md)。数据集/歌曲/谱页及定位数据集/记录均有独立pathname，query保留筛选、页码、视图与选区；兼容旧hash深链。几何确认不等于音乐内容真值，历史AI确认默认待人工复核。生产包在云端构建，部署前备份并expand至schema5；推送不会自动升级ECS。


按类别导出ZIP：`node tools/cli/xianji-omr.mjs datasets export DATASET_ID --classes guitar,lyrics --output dataset.zip --origin URL`。默认导出裁片，`--kind detection`导出检测包；详见[CLI说明](tools/cli/README.md#按类别直接导出-zipcli-050)。

### CLI 调用平台接口部署

先按原方式将ECS升级到包含此接口的schema9版本一次，之后可直接用CLI授权并发起ECS端源码部署：

```bash
node tools/cli/xianji-omr.mjs auth --deploy --origin https://omr.example.com
node tools/cli/xianji-omr.mjs platform deploy --wait --origin https://omr.example.com
node tools/cli/xianji-omr.mjs platform status --origin https://omr.example.com
```

CLI只请求平台HTTP接口；ECS固定拉取main并执行既有受限构建、备份、迁移和健康检查。任务由独立systemd控制器执行，平台重启后可以继续查询，无需本机SSH或部署包。需单独授予platform:deploy权限。完整说明见 [CLI部署文档](tools/cli/README.md#通过平台-api-部署070schema9)。


## 本地训练与模型评估

新增训练监控和图片推理模块，运行方式与部署前置条件见 [训练说明](tools/training/README.md)。平台需升级至 schema10；本机可双击 `start-training.cmd` 启动。

## 调号标注与任务分组（schema11 / CLI 0.8.0）

切图标注下新增「数据标注 / 模型训练 / 图片推理」子 tab，训练与推理页面改为 `/layout/training`、`/layout/models`，旧链接自动跳转。调号标注支持关联切图数据集并批量提取调号框、切图列表筛选分页、键盘标注及人工标签导出。CLI 支持 `layout` 与 `key-signatures` 任务前缀；原有切图根命令兼容保留。详见 [调号标注与 CLI 说明](docs/key-signature-annotation.md)。
### Windows 本地验收

双击 `start-dev.cmd`，依赖齐全时也可运行 `npm run dev:local`。本地入口为 `http://localhost:4173/__test-login`，仅监听回环地址，使用独立临时 PostgreSQL、演示图片和样例数据，不连接生产数据库或 OSS。重启会新建演示数据；默认包含 9 张调号切图，已标注 2 张。切图模型训练和推理仍显示真实接口提供的记录，本地空库不会伪造已训练模型。
调号与拍号标注均提供每日标注图表；列表不显示图片，编辑器显示切图。拍号 CLI 使用 time-signatures 前缀，本地验收入口会生成两种样例数据集。本次新增迁移至 schema13。
