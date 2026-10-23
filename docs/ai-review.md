# 谱页 AI 复核状态

切图谱页新增 `ai_reviewed`（AI 已复核），保留原 `draft` 和 `confirmed`。列表可筛选，编辑器可显式标记或取消。此按钮记录已有AI复核结论，不调用模型、不自动识别。

AI复核与人工确认独立：只有`confirmed`计入人工确认数和确认数据冻结导出；AI页仍属于“下一页”人工待办队列。AI复核不把区域升级为人工确认；修改保存后整页回到草稿。历史数据和冻结快照状态不重写。

沿用现有确认API和`data:confirm`权限、Origin/会话与乐观锁：

```http
POST /api/v2/pages/:pageId/confirm
Content-Type: application/json

{"version":3,"acknowledged":true,"reviewType":"ai"}
```

`reviewType`可选`ai`/`human`，省略保持旧客户端人工确认行为；未知值400，旧版本409，无确认权限403。撤销仍使用`POST /api/v2/pages/:pageId/unconfirm`。列表`GET /api/v2/datasets/:datasetId/pages?status=ai_reviewed`，返回页面`image.status`为`ai_reviewed`。AI复核要求与人工确认相同的区域几何有效性检查。

CLI：

```bash
node tools/cli/xianji-omr.mjs pages confirm PAGE_UUID --version 3 --acknowledge --review-type ai --origin http://116.62.12.100:8790 --allow-insecure-http
node tools/cli/xianji-omr.mjs records list DATASET_UUID --status ai_reviewed --origin http://116.62.12.100:8790 --allow-insecure-http
```

HTTP明文风险不变。未提供`--review-type`的旧命令保持兼容。平台先升级才支持新状态。

schema7仅扩展页面状态约束，不自动改变已有确认/草稿或快照；部署脚本仍先备份再迁移。生产未部署，浏览器本轮未实测。

本轮验证：严格类型检查、Node22生产构建通过；隔离PG18/mockOSS的全量`npm test`为59/59通过（0跳过），含AI复核真实CLI入口、旧客户端确认、迁移/备份恢复、授权/快照及实际部署归档构建启动。未连接真实RDS/OSS。
