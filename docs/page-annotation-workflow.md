# 单页切图工作流

数据集列表按单张谱页分页展示序号、归属歌曲、框数和标记状态，不再按歌曲聚合。序号是当前查询稳定排序后的行号，不是原曲页序。搜索/状态/集合筛选、分页、永久删除及查看裁片沿用现有接口。

点击进入当前谱页的独立编辑URL；编辑器没有左侧歌曲页列表或页序拖动，也没有上一首/下一首。歌曲归属、split、历史页序和已有标注均保留，旧歌曲链接仍可解析到其首页。

顶部“下一页”通过现有 `GET /api/v2/datasets/:datasetId/pages/:pageId/neighbors` 新增响应字段 `nextUnconfirmed: {id,songId} | null` 查找本数据集内下一张未确认页。沿用列表的创建时间倒序/ID倒序，末尾循环，跳过当前页、确认页与删除页。工作队列独立于表格筛选，避免列表筛选“已确认”时无法继续标记。原previous/next字段和CLI契约保持兼容。未保存离开继续走现有保存/放弃/取消机制。

不需要数据库迁移，不操作生产数据。隔离PG测试覆盖跨歌曲跳转、已确认跳过、末尾循环、无待办、分页及数据集隔离。浏览器交互本轮未实测。

本轮验收：`npm run typecheck`、Node22 `node server/build.mjs`通过；`PATH=/tmp/omr-pg-tools/bin:$PATH OMR_RUNTIME_NODE=/tmp/omr-node22/node_modules/node/bin/node npm test` 58/58通过、0跳过，包含CLI、永久删除、迁移/备份恢复及部署归档回归。
