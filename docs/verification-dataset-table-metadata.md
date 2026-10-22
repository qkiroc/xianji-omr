# 歌曲目录、元信息与裁片检查验收

日期：2026-10-22。开发目录：GPT云端 `/workspace/scratch/82acab135f2b/repository`。本轮基于main 9f773fdb4820e7a1155b410488b8abdb05c44a71安全整合，保留AF_NETLINK、已有CLI授权及全部远端历史；没有访问Mac、ECS、真实RDS/OSS，没有部署生产，没有子代理。

## 实际通过

`npm run build`、`PATH=/tmp/omr-pg-tools/bin:$PATH npm test`：**27 tests、27 pass、0 fail、0 skip**。隔离PostgreSQL18.1，独立临时目录/数据库、非超级应用账号与内存mock OSS，非真实云资源。最终输出保留在任务 `/tmp/omr-delivery-tests.log`。

- 原有后端/图片上传、EXIF转换、幂等迁移、实际备份恢复、故障补偿、版本冲突、授权/PKCE/撤销/Origin、限流有界和错误--version入口回归持续通过。
- schema3带图片version9/标注、网页登录会话、CLI grant、ready快照升级4并重复迁移，旧数据和授权保持；schema1原框/会话升级也通过。
- 图像目录2051行真实PG插入：分页、来源搜索/状态筛选计数、稳定排序、跨页邻居、不在分页传输全部boxes；歌曲62行真实PG分页/搜索，聚合页数和确认数正确。
- 数据集、歌曲、原图独立软删除：旧版本/跨数据集/批处理全败回滚、并发旧页200/409、legacy绕过阻断；恢复数据集不恢复已删除歌曲，恢复歌曲不恢复已独立删除谱页。OSS原图对象和冻结内容不删除。
- 歌曲内部完整页序原子交换：缺页/跨歌曲/陈旧version拒绝；保留删除页序槽位；标注及确认不改变。
- 六类元信息：空值、原文、多行标题、身份区分、原调/演奏调、Capo0与缺省、BPM拍单位/附点、page/global/local和本页可选父谱行；保存回读、CLI与原生/COCO/裁片映射保留内容。旧七类ID不重排，v1覆盖v2拒绝。
- 逐框复核：data:write不能确认、data:read不能标调整、伪造PUT confirmed无效；改一个框只撤回该框，其余确认保留；旧客户端不带reviewStatus仍保留服务端状态。标需调整不删除；移除后保存可恢复同ID/内容，复核恢复draft；单框全确认不替代整页查漏确认。
- 裁切共享整数边界，越界/零尺寸拒绝，正常父子重叠可用。非纯色测试图导出裁片与相同矩形的原像素逐字节相等；保存后变化不更改已冻结几何；预览/复核不复制原图或虚增样本。
- v1导出7类与v2导出13类均经Python独立验证器校验双ZIP；同图不同标注/跨split拒绝，选择批次也不能绕过全数据集跨split隔离。
- **36业务路由模板全部有CLI映射，并分别通过源码入口和实际tar.gz干净解压目录子进程调用真实API**（没有repo node_modules/private config依赖）。含file/stdin真实图片、乐观锁冲突、显式确认、六类往返、软删除恢复、页序、逐框复核/恢复、两个ZIP哈希/内容校验；列表最新30之外的旧快照仍可下载。
- 实际git archive使用生产路径白名单：干净目录npm ci --omit=dev、build、生产入口连接隔离PG启动/健康schema4、授权静态页及未登录API401；无workspace，service保留AF_NETLINK。

`python3 test/config-pty.py`通过：隐藏输入、原子0640受限配置、重复复用与Ctrl-C清理。`bash -n deploy/deploy.sh deploy/bootstrap.sh`、`git diff --check`通过。未改root package/lock或既有生产service访问限制。

## 实际浏览器验证

云端Chrome + 受管隔离预览，均为生成测试图/测试账号：

1. 卡片→歌曲表（单首歌3页、9框、1/3确认），搜索/筛选，打开歌曲后无全局header/nav，仅当前歌曲谱页栏。
2. 鼠标实际将第二页拖到第一位，刷新顺序仍保留，当前编辑页不变；前后页/返回表格继续工作。歌曲行和卡片删除操作不误开编辑。
3. 选中标题仅显示该框；移动、四角调整、删除/撤销/重做；50%与200%下相同坐标x80/y65/w588/h54，保存重开保留。六类属性可读，BPM局部范围/八分音符与附点、Capo0可保存。保留草稿离开再重开提示恢复，原草稿版本继续保留。
4. 单独删第三谱页→删歌曲→批量恢复歌曲，已单独删除第三页仍留已删除视图，随后可单独恢复。数据集删除/恢复此前也用隔离图走过确认及影响计数。
5. “查看裁片”直接进入结果；原图总览包含所有框，网格与完整谱行宽卡、类别/复核筛选、大图、通过稳定meta-0 ID回原图定位。改变标题尺寸后只有本框未复核，其余6框保持确认；标需调整不删图；保存删除后可恢复同ID/内容；改类别即时归入新筛选，可撤销。
6. 切换原图/裁片保留草稿和筛选；实际记录滚动scrollTop=654，回选完整谱行后返回仍为654；重新打开保留相同裁片尺寸/状态。图标操作一行、aria-label/title保留，视图切换顶部居中，不再有页面来源/曲目/页序弹窗。快照/导出后续改为歌曲列表顶部独立按钮及弹窗。
7. 浏览器点击整页确认并创建快照，界面显示ready、1来源页/1训练图/7框及两种下载链接。**浏览器工具等待download事件超时，未取得浏览器下载文件，因此不声称完成浏览器文件落盘验收**；相同认证API的两类流式下载及ZIP/像素校验已由实际CLI/API集成通过。

任务截图（不提交二进制至Git）：`/workspace/scratch/omr-dataset-cards.jpg`、`omr-song-table.jpg`、`omr-focused-song-editor.jpg`、`omr-song-delete-confirm.jpg`、`omr-crops-final.jpg`、`omr-song-table-final.jpg`、`omr-export-dialog.jpg`。前几张记录分阶段布局，最终布局以omr-crops-final.jpg为准。测试种子脚本test/catalogue-browser.mjs只连接127.0.0.1隔离预览，不接触生产。

## 交付和升级边界

CLI0.2.0源码离线包：`/workspace/scratch/xianji-omr-cli-delivery/xianji-omr-cli-0.2.0.tar.gz`；SHA256 `7b70f166567c70da1c9b5ab5637c9e5fd4419722e3ea34abf09f9dba328facbe`。只有CLI源码/README/清单，无npm包、凭据、服务器依赖或数据。完整命令及新API见tools/cli/README.md。

schema4为004增量迁移，删除状态分别记录父/子；annotation_version与deleted_boxes新增，不改旧annotation_format约束或既有迁移校验和。最多保留5000已删除区域/页，超出拒绝保存而不丢历史。旧ready快照不可变，新导出只取活跃确认页；旧v1模型仍只有原七类能力。裁片预览可等比降采样、最大大图边4096；导出保持原始整数尺寸，未训练自动识别文字。

现有ECS安装由用户在源码目录执行：

```bash
git pull --ff-only
sudo bash deploy/deploy.sh
```

部署脚本先备份再迁移/发布。schema3 release不兼容schema4，健康失败不可让旧程序写新库；按现有兼容策略停服保留备份/release，不drop/reset、不用备份自动覆盖数据库。不要手动回退旧schema程序。

预览只在当前云端任务服务存活期间可用，隔离PG/mock对象数据临时，不是云端持久化生产。GitHub推送不自动更新现有ECS。未实测真实OSS/RDS/RAM Role/systemd/跨浏览器及Windows桌面；HTTP仍需CLI显式允许且明文风险不变。真实云资源联调应在用户升级ECS后完成。

后续列表简化已检查：歌曲表移除缩略图列与底部重复管理区；行内歌曲信息仍打开名称/songGroupKey/训练用途表单且不会误开编辑器。构建、两份JS语法检查、git diff --check及隔离Chrome实际表格/弹窗检查通过；此次纯UI调整未重复运行后端全套测试。截图任务路径 `/workspace/scratch/omr-song-list-compact.jpg`。
