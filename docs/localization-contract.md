# 小节与事件定位 API / CLI（schema5，CLI0.3.0）

须先升级平台；旧生产版本没有以下接口。本任务不部署生产、不导入真实语料。Node>=22.18，CLI仅Node内置模块，无npm安装、MCP或workspaces。API共50个业务模板（旧36+定位14），原命令及按origin浏览器授权不变。

## 授权与来源

```bash
node tools/cli/xianji-omr.mjs auth --origin http://116.62.12.100:8790 --allow-insecure-http
node tools/cli/xianji-omr.mjs localization datasets create --input - <<'JSON'
{"name":"真实谱页定位","description":"历史导入，默认待复核"}
JSON
node tools/cli/xianji-omr.mjs localization datasets list
```

用户在浏览器登录并点击授权。HTTP需要显式同意且会警告明文风险；PKCE不加密公网传输。CLI不输入平台密码，不读Cookie/OSS/RDS配置。所有命令可带`--origin`选择已授权平台。授权范围沿用data:read/write/confirm，下载使用data:read；快照创建使用data:write。普通保存不能确认。

原图先通过旧`pages upload`上传或使用已有UUID，不能上传事件裁片当原图。本地历史asset_id必须在sourcePageMap中逐页映射。曲组和split继承原平台歌曲，导入group_id/split不一致409整笔拒绝。24张合成图请用独立数据集/来源曲组，不混入真实原图映射。不同revision创建独立记录，不覆盖已改/已确认记录。当前仅接收原图像素的恒等coordinate_mapping；非恒等422，迁移脚本须先明确转换，并在原附件/报告保留转换依据，不能猜测。

## 完整导入示例

结构约束见[JSON Schema](localization-import.schema.json)，平台另外验证原图、group/split、边界、ID唯一、乐观锁和确认规则。空bbox、staff_lines、center_x允许草稿，未给几何不生成候选。音乐label/relations/texts及所有未知字段完整保留在record.original，不参与几何编辑/训练真值。

```bash
node tools/cli/xianji-omr.mjs localization records import --dataset 定位数据集UUID --input - <<'JSON'
{
 "corpus":{
  "version":"omr-event-corpus-v1","revision":2,"label_format":"omr-music-event-v1",
  "source":{"sample_id":"local-id","revision":1,"title":"老男孩","group_id":"real-score:老男孩","domain":"real","pages":[{"asset_id":"local-page-id","width":1280,"height":1810,"sha256":"原图64位小写SHA256","pixel_sha256":"原始像素证据SHA256","coordinate_mapping":[[1,0,0],[0,1,0],[0,0,1]]}]},
  "split":"train","provenance":{"method":"image_proposals_reference_separate_v1"},
  "measures":[{"id":"row1:b1:guitar","page_id":"local-page-id","bar_number":1,"system_id":"row1","track":"guitar","voice":"1","bbox_xyxy":[60,300,550,480],"staff_lines":[330,350,370,390,410,430],"geometry_reviewed":true,"completeness_reviewed":true,"reviewer":"历史AI复核者","events":[{"id":"e1","center_x":120.5,"bbox_xyxy":[100,300,145,480],"context_bbox_xyxy":[60,300,550,480],"review_status":"accepted","confidence":null,"evidence":{"method":"visual"},"annotation_source":{"kind":"visual_review","reviewer":"AI","observed":true},"label":{"readonly":"保留原音乐内容"}}]}],
  "relations":[],"texts":[]
 },
 "sourcePageMap":{"local-page-id":"平台sourcePageId UUID"}
}
JSON
```

例中的SHA与UUID须替换为实际映射值，不是可直接导入的测试数据。单次请求/CLI输入最多2MiB；每记录1–100页、1000小节轨道、每小节5000事件、总事件20000。需要逐语料导入，记录返回id/version/warnings，并保留迁移报告，不将raw accepted总数当独立金标。

幂等键：dataset + sample_id + revision + 来源平台UUID/实际与历史SHA集合摘要。同键同原始输入返回`idempotent:true`及当前记录；不同输入409，不覆盖。新的revision需要人工复核，原geometry_reviewed/accepted只保留来源，永不自动平台确认。

编码不同但解码RGB一致时，可在顶层增加：

```json
{"pixelEquivalence":{"local-page-id":{"mode":"decoded-rgb-v1","acknowledged":true,"platformSha256":"平台字节SHA256","historicalSha256":"历史字节SHA256","rgbSha256":"共同RGB SHA256"}}}
```

定位sources content返回不自动旋转、剥离EXIF的PNG坐标视图（响应SHA校验该PNG），不是原文件编码。取原始字节使用旧命令`pages content PAGE_UUID --original --output 原文件`，导入来源SHA始终是平台原始文件SHA。

RGB算法：无EXIF自动旋转，去alpha、sRGB、8位交错RGB原始字节SHA256，原图宽高须相等。迁移端须分别解码两张图验证相同，再显式声明；平台核验自己原图的字节SHA及RGB SHA，**不声称已读取历史图片独立验证两者相等**。原历史SHA及等价证据保存在geometry.pages，原附件不改。平台原图日后变化仍拒绝旧记录读写/确认，不能以旧等价证明绕过。

## 编辑、确认、拒绝

```bash
node tools/cli/xianji-omr.mjs localization records list --dataset UUID --status draft --split train --source image_proposals_reference_separate_v1 --page 1 --page-size 50
node tools/cli/xianji-omr.mjs localization records get RECORD_UUID > record.json
# 提取完整geometry到update.json: {"version":当前版本,"geometry":完整geometry对象}
node tools/cli/xianji-omr.mjs localization records update RECORD_UUID --input update.json
node tools/cli/xianji-omr.mjs localization records confirm RECORD_UUID --version 2 --acknowledge
node tools/cli/xianji-omr.mjs localization records unconfirm RECORD_UUID --version 3
node tools/cli/xianji-omr.mjs localization events reject RECORD_UUID --event e1 --version 4
node tools/cli/xianji-omr.mjs localization events restore RECORD_UUID --event e1 --version 5
node tools/cli/xianji-omr.mjs localization sources content PAGE_UUID --output original-coordinate.png
```

每次修改返回递增version；示例数字仅示意，必须使用上一响应版本。PUT接受完整geometry（字段见shared/localization.ts），不能改pages来源。bbox是整数原图xyxy，centerX/staffLines是有限小数并保留导入精度。稳定ID不能以序号代替。guitar确认要求六根递增弦线及有效bbox，同声部未拒绝事件必须按x严格递增且落在小节中；melody不要求六根弦线。确认需明确人工完整性声明，几何确认不是音符内容真值。几何变更撤销受影响小节的确认，其余小节保持；记录回草稿。拒绝保留证据与事件ID，恢复为candidate，不删除。未知几何可保存但不能确认。409保留调用端草稿，不能盲目重读版本后强写。

## 冻结与下载

```bash
node tools/cli/xianji-omr.mjs localization snapshots create --dataset UUID --input - <<'JSON'
{"recordIds":["已确认记录UUID"]}
JSON
node tools/cli/xianji-omr.mjs localization snapshots list --dataset UUID
node tools/cli/xianji-omr.mjs localization snapshots download SNAPSHOT_UUID --kind native --output geometry.json
node tools/cli/xianji-omr.mjs localization snapshots download SNAPSHOT_UUID --kind crops --output crops.zip
```

省略recordIds时冻结该数据集全部确认记录，上限100份/3000小节/8MiB原附件与几何JSON；更多记录用显式recordIds分批，不拆数据集。数据库冻结geometry、来源、原始附件、指纹，不随后续编辑变化。原生格式omr-localization-snapshot-v1，geometry格式omr-localization-v1，裁片manifest格式omr-localization-crops-v1。裁片只用明确bbox（事件无bbox时用已标contextBBox），不猜裁片；拒绝事件不导出。ZIP逐原图处理，最多20000张/2亿裁片像素/512MiB PNG，超限失败请分批。manifest记录源UUID、SHA、record/measure/event稳定ID、整数bbox及每裁片SHA。下载响应精确Content-Length及X-Checksum-Sha256，CLI流式.part校验后原子保存，拒绝覆盖。无范围猜测、自动预标注、训练或内容真值承诺。

## HTTP接口映射

所有路径前缀`/api/v2/localization`：

| CLI命令前缀 localization | 方法 / 路径 |
| --- | --- |
| datasets list/create | GET/POST /datasets |
| records list/import | GET /datasets/:id/records；POST /datasets/:id/import |
| records get/update | GET/PUT /records/:id |
| records confirm/unconfirm | POST /records/:id/confirm 或 unconfirm |
| events reject/restore | POST /records/:id/events/:eventId/reject 或 restore |
| sources content | GET /sources/:pageId/content |
| snapshots list/create | GET/POST /datasets/:id/snapshots |
| snapshots download | GET /snapshots/:id/:kind（native/crops） |

CLI JSON stdout、错误stderr；退出码沿用0成功、2参数/未确认、3授权、4权限、5版本冲突、6服务/网络、7文件下载（精确代码见CLI README）。不打印token。平台网页不保存IndexedDB草稿，未保存只在内存，离开须保存/放弃。

## 原生快照几何往返

原生JSON中每份`records[]`保留`original`和当前`geometry`。逐记录构造`{corpus: record.original, sourcePageMap: Object.fromEntries(record.geometry.pages.map(p => [p.localPageId,p.sourcePageId])), geometry: record.geometry}`，经相同`localization records import --input -`导入另一定位数据集，可保留后续人工几何调整及稳定ID，而不会只还原旧original中的位置。若存在历史编码等价映射，必须同时显式提交对应pixelEquivalence/acknowledged；geometry.pages必须与服务器核验后的实际来源完全一致，跨平台UUID需迁移端明确重映射，不能直接信任旧引用。导入仍撤销所有人工确认；同幂等键不同geometry也409，不覆盖旧记录。不要把原生整个records数组一次交给单记录导入。
