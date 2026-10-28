# 本地训练、平台监控与图片推理

首版任务是 `layout-v2` 的 13 类区域检测：谱行、六线谱、简谱、歌词、和弦区域及页级元信息。它训练自动切谱模型；音符、品位和时值转录属于后续内容识别任务。

## 运行位置

| 部分 | 运行位置 | 职责 |
| --- | --- | --- |
| 平台 Next.js / Node | ECS | 登录鉴权、训练记录、指标接口、推理队列、可视化 |
| PostgreSQL | 现有 RDS | 训练配置、数据指纹、顺序事件、文件元信息、推理任务 |
| OSS | 现有私有桶 | ONNX、最佳权重、报告、评估图、推理输入图片 |
| 训练程序 | 本机 NVIDIA GPU | 拉取已确认页、校验与划分、训练、评估、导出和上报 |
| 推理 worker | 本机 CPU | 下载已发布 ONNX、领取图片任务、返回检测框 |

ECS 无需安装 PyTorch 或 ONNX Runtime。本机无需开放入站端口。图片推理要求至少一个 worker 保持在线；本机离线时网页会提示。worker 也可以独立部署到另一台能访问平台的机器。

## 先部署平台代码

本功能新增 **schema13**、`/layout/training` 和 `/layout/models` 页面，以及 `/api/v2/training/*` 接口。先按现有部署流程构建并部署含 `010-training.sql` 的版本。启动脚本会先检查平台训练接口；旧平台或授权失效时停止，不先下载数 GB 的训练依赖。

已有 CLI 授权可复用。没有授权时，在正常的本机终端执行：

```powershell
node --use-env-proxy tools/cli/xianji-omr.mjs auth --origin http://116.62.12.100:8790 --allow-insecure-http
```

上述 `--use-env-proxy` 适用于 Node 24；较旧 Node 若不识别该参数，可去掉。授权跟随 origin 隔离，不把 token 写到训练输出或模型报告。

## 一键开始

推荐 Node 24、Python 3.11/3.12，以及支持 CUDA 12.8 的 NVIDIA 驱动。Windows 入口会创建独立虚拟环境，安装 PyTorch 2.10.0 / torchvision 0.25.0 CUDA 12.8 版本，再安装训练依赖。

项目根目录双击 `start-training.cmd`，或执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\training\start.ps1
```

默认下载所有布局数据集中 `confirmed` 的活动页，包含人工确认页和已确认合成页；`ai_reviewed`、草稿和已删除页排除。默认 YOLO11s、1280 分辨率、batch=4、100 epochs、25 轮无改善早停。训练结束自动评估最佳模型、上传结果，随后保持推理 worker 运行。

可以指定空间更充足的本地目录、数据集和训练规模：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\training\start.ps1 -OutputRoot D:\xianji-training -Epochs 100 -Batch 4
# -DatasetIds 接受 PowerShell 字符串数组；可直接在 PowerShell 中调用：
.\tools\training\start.ps1 -DatasetIds @('实际数据集UUID') -OutputRoot D:\xianji-training
```

参数：`-Origin`、`-OutputRoot`、`-PythonExe`、`-DatasetIds`、`-Epochs`、`-ImageSize`、`-Batch`、`-SkipSync`、`-NoServe`。空间不足会停止并保留已有文件，不自动清理用户目录。显存不足时可用较小 Batch 创建新训练。

下载或训练过程中，可以在平台打开 **模型训练**。每个任务显示状态、epoch、损失、precision、recall、mAP50、mAP50–95、数据集统计、事件和评估图。训练指标在每轮结束后产生；心跳约每 15 秒产生；客户端每 2 秒尝试上报，网页每 2 秒读取。

## 下载与数据校验

独立下载：

```powershell
node --use-env-proxy tools/training/sync-confirmed.mjs --output .artifacts/training/data
# 可重复 --dataset UUID；默认读取所有活动布局数据集。
```

离线构建训练集：

```powershell
.artifacts/training/.venv/Scripts/python.exe tools/training/prepare_dataset.py --data-root .artifacts/training/data
```

下载使用 GET 接口，不修改平台标注状态。保存原图、坐标所对应的工作图，以及页版本和完整区域标注。每个图片校验 SHA256 和长度。下载结束再次核对目录版本，下载期间发生增删或修改则停止，重跑复用已校验缓存。

训练集构建会检查尺寸、EXIF 方向、框边界、类别、同歌集合划分和解码 RGB 重复；同图不同标签或跨集合会拒绝。相同图片和标签去重并保留来源别名。原有验证/测试组不会移入训练集；缺少独立 holdout 时仅在本地按歌曲组划出验证/测试组，记录在 `splitOverrides`，不修改平台。若可能，会保留真实页验证/测试组。没有真实评测页或类别缺少训练样本时显示警告。

检测标签使用工作图坐标，原图单独保留；已有父子框、阅读顺序和元数据也保留在下载 manifest 中。合成数据通过 `source` 的 `synthetic:` 前缀区分，其他数据标为 `confirmed_other`，不推断为逐张人工审读。

## 中断、断网与补传

下载可以重复运行以复用缓存。模型训练保留 `fit/weights/last.pt`，未发送事件持久化到 `events.jsonl`。仍处于 running 的同一任务可使用冻结数据恢复：

```powershell
.\tools\training\start.ps1 -Resume 'D:\xianji-training\runs\实际训练UUID' -OutputRoot D:\xianji-training
```

已明确失败的任务保留记录，创建新训练进行修复。恢复任务的指纹和配置固定。发布失败后无需重新训练：

```powershell
.\tools\training\start.ps1 -Publish 'D:\xianji-training\runs\实际训练UUID' -OutputRoot D:\xianji-training
```

补传会回放未确认事件；必要时重新评估/导出最佳 checkpoint，再上传文件。事件按 `(run_id,seq)` 去重，相同序号不同内容返回冲突。必须上传 ONNX、最佳权重及指纹匹配的报告，平台才会把模型标为完成。

## 图片推理

训练完成后入口默认继续运行 worker。单独启动：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\training\start.ps1 -WorkerOnly
```

打开平台 **图片推理**，选择完成的模型，上传 PNG/JPEG/WebP，调整置信度，查看原图叠加框、类别、分数和耗时，也可导出 JSON。不同类别分别执行 NMS，完整谱行和子区域可以重叠。

worker 只执行经过校验的 ONNX，不加载平台上传的 `.pt`。文件缓存按 SHA256 索引；输入采用与检测图一致的 letterbox、RGB NCHW float32。逆变换后返回规范化原图坐标。预测任务有 90 秒租约，每 15 秒续约；旧租约结果拒绝接收，超时任务可重领一次。排队超过 5 分钟或再次超时会明确失败。

图片推理输入会由平台校正 EXIF 方向并保存，页面展示同一张规范化图片。推理结果不会自动写入标注真值。

## 输出与验证

输出默认在 `.artifacts/training/`：`data/` 保存下载与冻结 manifest；`data/prepared/` 保存 YOLO 数据和审计；`runs/<UUID>/` 保存运行配置、环境、精确依赖清单、指标 outbox、checkpoint、ONNX 与评估报告。

```powershell
node --test test/training.test.mjs test/training-api.test.mjs
python test/training-python.test.py -v
npm run typecheck
npm run build
```

Node 接口测试使用内存存储替身，验证状态流转、所有权、原子事件回放和发布门槛；不替代真实 PostgreSQL/OSS 集成测试。首次真实训练还需验证 CUDA、Ultralytics 回调和导出的 ONNX。在网络/依赖齐备的环境完成构建、数据库迁移和网页联调后再部署使用。

## 透明图片与重复标注

带透明度的谱图先与白底合成 RGB，再计算可见像素指纹；准备给 YOLO 的图片也保存为无透明通道的 RGB PNG。原始下载缓存保持不变，推理使用相同的白底处理。数据准备版本 2 使用新的目录指纹，避免复用旧黑图缓存。

同一张可见图片有不同标注时，默认仍停止，并将完整冲突组写入 `data/conflicts/<源数据指纹>.json`。检查报告后，可以显式使用 `-ExcludeConflicts`：整个冲突组中的所有副本都会从本次训练中排除，平台标注、原始图片及下载清单保持不变。排除数、报告路径和图片转换数写入训练审计及平台数据统计；不会自动选一套标注作为真值。

数据已完整下载时，无需重新同步：

```powershell
.\start-training.cmd -OutputRoot E:\xianji-omr\.artifacts\training -SkipSync -ExcludeConflicts
```

可独立检查数据，或将准备结果写入其他目录：

```powershell
.artifacts/training/.venv/Scripts/python.exe tools/training/prepare_dataset.py --data-root .artifacts/training/data --exclude-conflicts
# --output-root 仅更改 prepared、conflicts 和 prepared-latest.json 的保存目录，源数据仍从 --data-root 读取。
```

## 模型上传失败后的补传

训练、评估及 ONNX 导出完成后，网络中断不会丢失权重。`publication.json` 固定了需要上传的文件；`-Publish` 直接复用这些文件，不重新训练或重新评估。补传时会校验平台已登记文件的 SHA256 和长度并跳过一致文件；不一致则停止，不覆盖原文件。网络及临时服务错误会重试，授权和内容冲突错误直接停止。

平台的大文件流式上传使用 10 分钟 OSS 时限，本地上传等待上限为 15 分钟；普通元信息请求保留短超时。更新本修复的服务端版本后执行：

```powershell
.\start-training.cmd -Publish 'E:\xianji-omr\.artifacts\training\runs\实际训练UUID'
```

默认补传成功后继续启动本地推理 worker，保持终端运行即可在平台上传图片测试。仅需补传时加 `-NoServe`；也可稍后用 `-WorkerOnly` 独立启动 worker。连接失败会打印异常类型及系统错误码，便于区分超时、连接重置及权限问题，不输出凭证。
