# 弦记 OMR 独立 CLI

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
