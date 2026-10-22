# 数据表与元信息实施计划

Goal：卡片→分页歌曲表→带歌曲谱页侧栏的独立编辑器，安全可恢复删除和六类完整元信息框。
Architecture：原生ESM/Express/pg，原网页Canvas，独立Node CLI；schema4增量与taxonomy v2追加，OSS对象和冻结来源不可变。
Tech Stack：现有Node22/PG18/sharp/原生HTML，无新框架或依赖。
Spec：[设计](../specs/2026-10-22-dataset-table-metadata-design.md)。Constraints：仅云端，无子代理、无生产操作、无强推。

- [x] schema4、taxonomy v2/metadata校验、旧格式保护：server/migrations/004-dataset-lifecycle.sql、annotation.mjs、pages.mjs。
- [x] 数据集/歌曲/图片状态、批处理、分页/邻居与页序原子交换、legacy一致守卫与统一锁：datasets.mjs、catalogue.mjs、song-catalogue.mjs、app.mjs、snapshots.mjs。
- [x] 冻结/导出保留类别版本与内容：snapshots/exporter、validate-export.py；旧快照解释不变。
- [x] CLI映射/筛选参数/删除恢复，保留旧命令：tools/cli，真实入口及离线重跑。
- [x] 左侧导航、卡片首页、分页表格/管理弹窗、URL上下文：web/index.html/app.js/styles.css/catalogue.js。
- [x] 六类属性控件、备份导入和草稿保护、歌曲内前后页与拖拽排序：web/app.js/metadata.js/canvas.js，保留选中隔离显示。
- [x] 隔离PG/mock测试：软删除父/子、计数/过滤/数千行、并发/旧version、跨dataset、metadata六类及v1/v2快照兼容。
- [x] 浏览器真实闭环和截图；npm run build，PATH=/tmp/omr-pg-tools/bin:$PATH npm test，python3 test/config-pty.py，bash -n deploy/deploy.sh deploy/bootstrap.sh，git diff --check。
- [x] 更新README/迁移说明/验收记录，fetch安全整合后commit/push main并核对SHA/干净工作区。

用户最后更新：列表按歌曲聚合，编辑器只保留歌曲谱页导航，拖拽排序（完整版本列表）；此前按原图行的API继续用于CLI兼容。

API测试示例：GET /api/v2/datasets/:id/song-records?page=2&pageSize=50；POST /api/v2/songs/:id/pages/reorder {items:[{id,version}]}；GET /api/v2/datasets/:id/pages?search=谱&page=2&pageSize=50；POST /api/v2/datasets/:id/pages/delete {items:[{id,version}]}；PUT /api/v2/pages/:id {version,annotationFormat:'layout-v2',boxes:[...metadata]}。测试须用实际路由与真实CLI子进程，不能只比较两份手写清单。用户已授权设计及实施，持续完成，不停在文档阶段。

## 追加裁片检查闭环

- [x] 共享整数裁切规则与语义比较，前端惰性预览/大图/总览/筛选/大小、ID回选定位、视图共享草稿及滚动位置：crop-rules.mjs、web/crops.js、app.js/canvas.js。
- [x] 逐框复核、权限与服务端失效规则、保存后区域软删除恢复：region-review.mjs、pages.mjs、identity.mjs、004 deleted_boxes；CLI regions review/restore，36路由。
- [x] PG/mock实测确认权限/伪造PUT/并发、单框变更保留其余确认、删除恢复、非纯色像素导出一致；原CLI/离线包/部署归档回归。
- [x] 浏览器裁片筛选/大图/定位/草稿/复核/删除恢复/滚动保留/重开与截图、最终检查推送。

验收命令：`PATH=/tmp/omr-pg-tools/bin:$PATH node --test test/crops-review.test.mjs test/cli.test.mjs test/cli-distribution.test.mjs test/deploy-archive.test.mjs`；最终执行全量npm test。review示例POST /api/v2/pages/:pageId/regions/meta-0/review {version,status:'confirmed',acknowledged:true}；restore同级路径需version。未操作生产、无新增模型识别逻辑。
