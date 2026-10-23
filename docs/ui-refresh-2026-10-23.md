# PC 管理平台界面整理

参考 Ant Design 的导航、布局和数据展示规范（https://ant.design/docs/spec/navigation/、https://ant.design/docs/spec/data-display/），沿用现有 React/Next 与原生控件，不新增组件框架或运行依赖。

- 统一蓝色主操作、灰阶文字、边框、8px节奏、按钮尺寸和键盘焦点；常驻导航标注当前任务，账号与辅助操作降低视觉权重。
- 数据集采用文件夹卡片、统计与更新时间分区；删除按钮独立于打开入口。区分加载、错误、空数据与回收站空态。
- 歌曲表格整理筛选面板、行内轻量操作、复核状态标签与空表提示；保留歌曲维度、分页、选择、删除恢复以及原API。
- 两个编辑器保持无全局导航的全屏模式，整理局部页列表、工具栏、画布背景、属性区与保存状态。文件导入保持原生输入及键盘焦点，通过紧凑样式避免暴露冗长文件输入。
- 不改后端、数据库、类别、坐标、授权、导出协议或部署入口，不操作生产。

验证：npm run typecheck、npm run build、git diff --check；node --test --test-concurrency=1 test/routes.test.mjs test/localization-edit.test.mjs test/cli-routes.test.mjs test/crops-review.test.mjs test/catalogue-metadata.test.mjs，11项通过（含隔离PG/mock存储）。另对已有部署脚本执行bash -n通过。没有把本次UI回归宣称为全套35项回归或ECS实测。

浏览器限制：隔离预览启动成功，但云端浏览器首次连接拒绝，后续页面观察被URL安全策略拦截，已停止重试。本次没有完成视觉/交互浏览器复验，没有新截图证据；部署后仍需在常见PC视口检查长名称、工具栏、滚动与实际显示。已有浏览器验收记录不代替本次视觉复验。
