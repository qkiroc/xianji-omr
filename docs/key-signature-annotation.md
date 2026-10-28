# 调号标注与任务分组（schema11 / CLI 0.8.0）

左侧按标注类型组织。切图标注下有「数据标注 / 模型训练 / 图片推理」三个子 tab，分别对应 `/datasets`、`/layout/training`、`/layout/models`。旧 `/training`、`/training/:id`、`/models?model=...` 链接跳转到新位置，已有训练 worker 使用的 `/api/v2/training/*` 接口保持兼容。当前训练和推理仍是 layout-v2 切图检测任务；调号模块提供标注数据，后续调号模型有自己的训练和推理入口。

## 数据集与切图列表

在「调号标注」新建数据集，选择关联的切图数据集。系统自动提取已保存的 `key_signature` 框，包括待复核页面上的框；其他类别、未保存的页面修改、已删除来源不导入。提取过程整体提交，失败不会留下半个数据集。

调号数据集内先显示切图列表：来源曲目与页码、调号、原调 / 选调、train/val/test、标注状态。支持搜索曲目和文件名，按状态、调号、类型、划分筛选，以及分页。点击某一行进入编辑器；「继续标注」进入数据集中的首个待标注项。返回列表保留筛选和页码，失效页码自动收敛到最后一页。

「补充导入」只追加新框。同一来源页、同一框 ID 不会重复导入，也不会覆盖已有人工调号标注。源页面以后调整框的位置，已导入切图仍使用导入时固定的范围。来源曲目组、划分和原始元信息也会保留，导入时不把原来的调号文字自动当成人工真值。

图片从来源工作图精确裁剪，不额外补边；读取时校验来源 SHA256。永久删除原图 / 曲目 / 切图数据集时，删除预览会显示受影响的调号标注数量，并一并清理这些标注；调号数据集本身保留，来源数据集被删除后解除关联。仅调整或删除来源框不会改变已导入的独立切图标注。

## 标注与快捷键

| 操作 | 快捷键 |
| --- | --- |
| 选择 C、D、E、F、G、A、B | 1–7 |
| 降号模式 / 将当前音改为降音 | ↓ |
| 升号模式 / 将当前音改为升音 | ↑ |
| 自然音模式 / 还原当前音 | 0 |
| 原调 | Q |
| 选调 | W |
| 保存并跳到下一个待标注项 | Enter |
| 浏览全部切图的上一个 / 下一个 | ← / → |

也可以直接点击所有自然音、降音、升音按钮；保留 C# 与 Db 等不同拼写。原调保存为 `kind=original`，选调保存为 `kind=play`。调号和类型都选择后才能提交。

左右键只切换图片，未提交选择暂存在当前页面，切回来可以继续。刷新或离开有未提交选择时会提示保存 / 放弃。按 Enter 先保存成功，再找下一个待标注项；到末尾会从开头寻找遗漏项，全完成时留在当前项并显示完成提示。保存失败保留选择，不跳图。保存采用版本校验，多页面同时编辑不会静默覆盖。图片未加载成功时不能标注或提交；文本输入、弹窗、输入法及浏览器组合键不会触发标注快捷键。

## 调号 API 与 CLI

CLI 已同步提供所有新 API，并保留原有根命令；切图命令也可显式使用 `layout` 前缀，例如 `layout datasets list`、`layout pages get PAGE_ID`、`layout datasets export DATASET_ID`。定位任务继续使用 `localization` 前缀。

以下命令均需已有 CLI 授权，并添加 `--origin URL`：

```powershell
# create.json: {"name":"调号训练集","sourceDatasetId":"切图数据集UUID"}
node tools/cli/xianji-omr.mjs key-signatures datasets create --input create.json
node tools/cli/xianji-omr.mjs key-signatures datasets list
node tools/cli/xianji-omr.mjs key-signatures datasets sync DATASET_ID

node tools/cli/xianji-omr.mjs key-signatures records list --dataset DATASET_ID --status draft --page 1 --page-size 50
node tools/cli/xianji-omr.mjs key-signatures records list --dataset DATASET_ID --tonic Db --kind original --search 曲目
node tools/cli/xianji-omr.mjs key-signatures records get RECORD_ID --dataset DATASET_ID
node tools/cli/xianji-omr.mjs key-signatures records content RECORD_ID --dataset DATASET_ID --output key.png

# label.json: {"version":1,"tonic":"Bb","kind":"original"}
node tools/cli/xianji-omr.mjs key-signatures records update RECORD_ID --dataset DATASET_ID --input label.json
node tools/cli/xianji-omr.mjs key-signatures records next --dataset DATASET_ID
node tools/cli/xianji-omr.mjs key-signatures records next RECORD_ID --dataset DATASET_ID --direction pending

node tools/cli/xianji-omr.mjs key-signatures datasets export DATASET_ID --output labels.json
```

导出仅含已保存的人工标注，保留曲目组、划分、来源、版本和固定裁剪范围；`imageUrl` 是需要平台授权的图片接口，不是内嵌图片。可用 `records content` 逐个下载；所有 CLI 文件下载都校验 SHA256，并拒绝覆盖已有文件。导出是当前标注清单，不替代切图任务的不可变训练快照。

## 切图训练与推理 CLI

```powershell
node tools/cli/xianji-omr.mjs layout training runs list
node tools/cli/xianji-omr.mjs layout training runs get RUN_ID
node tools/cli/xianji-omr.mjs layout training events list RUN_ID --after 0
node tools/cli/xianji-omr.mjs layout training artifacts download RUN_ID --kind onnx --output model.onnx

node tools/cli/xianji-omr.mjs layout inference workers list
node tools/cli/xianji-omr.mjs layout inference predict MODEL_ID --file score.png --confidence 0.25 --iou 0.45 --request-id REQUEST_UUID
node tools/cli/xianji-omr.mjs layout inference predictions get PREDICTION_ID
node tools/cli/xianji-omr.mjs layout inference predictions image PREDICTION_ID --output prediction.png
```

训练器和 worker 的注册、事件上报、模型发布、任务领取、续约、结果上报也都有 CLI 命令，详见 `--help`：

- `layout training runs create --input run.json`
- `layout training events append RUN_ID --input events.json`
- `layout training artifacts upload RUN_ID --kind weights --file weights.pt`
- `layout training runs complete RUN_ID`
- `layout inference workers heartbeat WORKER_ID --input worker.json`
- `layout inference predictions claim --input claim.json`
- `layout inference predictions heartbeat PREDICTION_ID --input lease.json`
- `layout inference predictions result PREDICTION_ID --input result.json`

模型文件类型支持 onnx、weights、report、results、confusion、preview。文件上传保留服务端大小、指纹、归属、租约和状态校验。推理直接上传图片二进制；显式传入 request-id 可安全重试同一请求。启动本地 GPU 训练和常驻推理 worker 仍使用 `tools/training/start.ps1`，其生成的页面链接已切换到切图任务下。

部署本功能需要按既有流程执行新增 `011-key-signatures.sql`，数据库兼容版本为 schema11。
## 拍号标注与每日统计（schema13）

拍号入口为 `/time-signatures/datasets`，与调号共享数据集创建、关联切图、去重补充导入、固定图片范围、版本校验、待标注队列、来源删除预览及导出逻辑。拍号从 `time_signature` 框提取，标签独立保存为整数 `numerator`、`denominator`。

拍号编辑器用数字 1–9、0 依次选择 4/4、3/4、2/4、6/8、3/8、2/2、6/4、9/8、12/8、5/4；也可以自定义分子 1–32、分母 1/2/4/8/16/32/64。回车保存并切换到下一个待标注项，左右键浏览。调号的升降号继续使用 ↑ / ↓，原调 / 选调继续使用 Q / W。

调号和拍号列表都不加载图片缩略图，图片在编辑器显示。两种列表均有每日标注量柱状图，可查看最近 7、14、30、90 天；以北京时间按首次成功保存计数，后续修改不移动日期、不重复计数。图表统计整个数据集，不受列表分页或表格筛选影响，无标注的日期补 0。旧调号记录没有首次保存时间时，迁移按最后保存日期回填并明确标记为估计数据。

拍号 CLI 与调号对应：

```powershell
# create-time.json: {"name":"拍号训练集","sourceDatasetId":"切图数据集UUID"}
node tools/cli/xianji-omr.mjs time-signatures datasets create --input create-time.json
node tools/cli/xianji-omr.mjs time-signatures datasets list
node tools/cli/xianji-omr.mjs time-signatures datasets sync DATASET_ID
node tools/cli/xianji-omr.mjs time-signatures records list --dataset DATASET_ID --status draft --trend-days 30
node tools/cli/xianji-omr.mjs time-signatures records list --dataset DATASET_ID --numerator 6 --denominator 8
node tools/cli/xianji-omr.mjs time-signatures records get RECORD_ID --dataset DATASET_ID
node tools/cli/xianji-omr.mjs time-signatures records content RECORD_ID --dataset DATASET_ID --output time.png
# time.json: {"version":1,"numerator":6,"denominator":8}
node tools/cli/xianji-omr.mjs time-signatures records update RECORD_ID --dataset DATASET_ID --input time.json
node tools/cli/xianji-omr.mjs time-signatures records next RECORD_ID --dataset DATASET_ID
node tools/cli/xianji-omr.mjs time-signatures datasets export DATASET_ID --output times.json
```

所有命令按既有授权添加 `--origin URL`。列表响应的 `annotationTrend` 同样供 CLI 使用。部署须依次应用 011、012、013 迁移；生产数据库不导入本地验收样例。部署源必须先提交并推送至 main，再触发 platform deploy，避免部署到旧提交。