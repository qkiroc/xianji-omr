# 切图标注 · xianji-omr

中文数据集管理与原图区域标注平台。支持数据集、曲目、多页页序、明确 songGroupKey 和曲目级 train/val/test；原七类及六类元信息整数像素框、父子谱行、裁片预览、撤销重做、草稿与人工确认。仅确认数据可冻结不可变快照，导出整页 YOLO/COCO/原生标注包及裁片来源映射包。训练在平台之外进行，本轮不含训练器、模型上传或自动识谱。

生产：Node22.18+同源网页/API，私有OSS存原图，PostgreSQL18存元信息/坐标/版本与会话；浏览器只保留本地草稿。请按 [ECS部署说明](deploy/README.md) 首次配置并运行 `sudo bash deploy/deploy.sh`。

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

开发预览默认4173，Origin为`http://terminal.local:4173`（云端QA）。如自行在开发机用回环地址启动，可修改test/preview.mjs的origin为实际地址。测试预览可访问`/__test-login`进入一次性模拟会话；此路由**仅存在于test fixture**，生产app及部署归档不包含test目录，生产只支持真实管理员登录。测试用户名/密码是固定虚构值，仅适用于隔离测试。

测试使用npm锁定的embedded-postgres PostgreSQL18.1二进制，端口55440（集成）、55439（预览），回环监听，随机临时目录/独立库，mock OSS不连接阿里云。Linux x64环境验证。非root正常运行；本Work云端仅映射UID0且禁止Unix socket，fixture在临时目录编译**仅测试使用**UID/stat兼容库，只注入隔离PG子进程，以TCP回环运行，不修改系统安全策略，也不进入生产包。需要gcc；不要将test fixture用于公网或生产。

本页备份 JSON schemaVersion=2，包含工作图 dataUrl、图片元信息及 layout-v2 boxes（classKey、parentSystemId、readingOrder、x/y/width/height、可选metadata）。导入创建新页面和未确认草稿，不覆盖原记录。兼容旧无类别 JSON，但保留为未归类草稿，不自动成为训练真值。浏览器旧草稿原记录保留，可在首页单独备份。数据库不存图片二进制或永久签名 URL。

快照逐图处理并校验图片哈希；相同原图跨 split、同曲组跨 split 或同图不同标注拒绝导出。同图同 split 且标注等价才去重，并保留来源映射。快照后编辑不会更改既有导出。类别版本 layout-v1：0 system、1 guitar、2 melody、3 lyrics、4 chord_marks、5 staff_notation、6 other_tab（COCO id 为 1–7）。标签只表达区域定位，不提供音符/歌词内容真值。

每次快照最多200来源页/10000来源框，单页最多5000框，临时数据文件合计512MB、每个ZIP最多512MB；单个导出任务串行运行，请预留至少2GB临时磁盘。裁片总像素每页不超过2亿。超过限制通过CLI snapshots create --input选择同数据集内一批确认页（pageIds），不拆分数据集；导出失败保留冻结清单，可重试。校验下载包：`python3 tools/validate-export.py detection.zip crops.zip`。

快捷键：V选择、R画框、H平移、空格/中键拖动平移、滚轮围绕鼠标缩放、Delete删除、Ctrl/⌘Z撤销、Shift+Ctrl/⌘Z重做。拖拽结束形成一次撤销记录。视图调整不进入标注撤销历史；刷新/重新打开会重置内存撤销栈，保留图片/标注草稿。

生产源文件为web/index.html、server/与deploy/；构建将网页复制到server/static，API为原生ESM。没有外部CDN、前端密钥、GitHub自动部署或PR。

## 独立 CLI（平台升级后使用）

[完整用法与离线分发](tools/cli/README.md)。仅需Node >=22.18.0，无自定义npm包、workspace或MCP。

```bash
node tools/cli/xianji-omr.mjs --version
node tools/cli/xianji-omr.mjs auth --origin http://116.62.12.100:8790 --allow-insecure-http
```

浏览器登录后明确批准，凭证按origin隔离，可在网页“CLI授权”撤销。HTTP是明文传输，PKCE不替代HTTPS。当前平台须先升级到schema3才有授权接口；推送GitHub不会自动更新ECS。原服务依赖/构建仍使用现有npm命令。

## 数据集与歌曲工作流（schema 4）

首页只有“切图标注”导航及数据集卡片。进入数据集后以**歌曲**分页展示，一首歌一行，含谱页数、区域数与确认进度；可按歌曲/文件名/来源搜索及状态/split筛选。点击歌曲进入无全局页头/导航的编辑器，左侧为该歌曲全部谱页。拖拽谱页调整顺序（也可上移/下移），页序立即保存，保持标注及确认状态；若有未保存标注请先保存。上一页/下一页始终在该歌曲内部导航，返回保留列表筛选和页码，直接URL/刷新恢复上下文。

数据集、歌曲、谱页均为可恢复删除，删除前展示影响范围。恢复父级不会恢复先前单独删除的子项；不永久删除OSS原图或历史冻结包。歌曲表“已删除”恢复歌曲；编辑器左侧“已删除谱页”恢复单页。删除/恢复递增子页版本，旧草稿遇409保持原样供合并。

layout-v2在原ID0–6后追加7标题、8歌手/演唱者、9拍号、10调号、11速度/BPM、12变调夹（COCO8–13），旧数据/模型/快照ID不重排。选区画完整字段区域，原文和结构化值均可空；页级框无需完整谱行父框，拍号/调号/速度可标曲中局部变化及可选谱行。Capo=0明确不夹，未填写不等于0；BPM保留拍单位/附点，速度词可只有原文。标题/演唱者只属于实际出现的曲目/谱本页，不向其他页复制。六类内容由native/COCO扩展字段及裁片映射保留，YOLO只提供区域定位。

当前迁移为schema4：新增删除状态、来源和annotation_version；旧annotation_format约束不重写。需升级后使用CLI0.2.0新增命令，详见[CLI说明](tools/cli/README.md)及[验收记录](docs/verification-dataset-table-metadata.md)。本轮不部署生产。

编辑器支持“原图编辑 / 裁片结果”：每框精确裁片、类别/逐框复核筛选、原图全部框总览、大图、ID回选并定位；切换共享草稿与撤销，保留筛选/滚动位置。修改某框后仅撤回该框确认，整页仍需人工查漏确认；需调整不删除数据。保存后删除区域可在裁片结果“已删除区域”恢复，保持原ID和元信息，恢复为未复核；不增加图片/训练样本。区域复核/恢复也可由独立CLI执行，当前36业务模板。
