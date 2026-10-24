# Ant Design 界面迁移

生产Next.js页面统一采用Ant Design 6.6.7，配合`@ant-design/nextjs-registry` 1.3.0处理App Router服务端样式收集；中文语言包和主题由`components/ui/provider.tsx`统一配置。依赖版本及完整依赖树由根package-lock锁定，无workspaces/MCP/npm发布包。

## 页面与控件

- 平台任务导航：Menu；数据集：Card；谱页和定位列表：Table、Pagination；状态：Tag。
- 登录、CLI授权、新建/编辑、筛选和属性面板：Form、Input/Password、TextArea、InputNumber、Select、Checkbox、Slider、Upload、Button。
- 未保存修改、删除、复核、导入、导出及其他应用弹窗：Modal；操作错误：Notification；帮助信息：Tooltip；高级属性：Collapse。
- 标注Canvas、裁片Canvas与定位SVG保留自定义像素交互，不改变标注坐标、确认语义、版本锁和训练数据规则。

`components/ui/antd.tsx`是薄适配层：让现有领域事件处理继续使用事件值和FormData；表格描述转换为Antd列/行，隐藏字段只用于FormData兼容，不是用户可见原生控件。异步Select选项更新时默认值正确恢复；Upload传递原始File，不自行请求上传；实际API仍负责类型/像素校验、OSS与数据库保存。

应用不使用window.confirm/alert/prompt；`shared/dialog.ts`通过App上下文桥接异步Modal结果。界面尚未挂载时拒绝确认，不默认为同意。删除请求仍在用户明确确认之后执行，取消不会触发执行接口。CLI浏览器审批保留原POST和提交按钮值，不取消Origin/会话/权限检查。

浏览器的文件选择系统窗口，以及刷新/关闭标签时对未保存内容的安全提示，由浏览器控制，无法替换为页面内Antd弹窗。站内离开仍使用Antd“保存/放弃/留在本页”。历史`web/`目录仅供原静态兼容测试；正式入口一直由Next渲染，不将其旧控件当成新UI交付。

## 验证边界

DOM交互测试使用Happy DOM挂载真实React/Antd组件，涵盖FormData、选择/勾选/数值、表格行操作隔离、Modal确认/取消、上传原始文件、异步选项、必填错误通知和提示更新。它不是Chrome浏览器视觉验收；本轮不提供未实际产生的浏览器截图。

既有隔离PostgreSQL18/mockOSS全量回归与真实CLI子进程、离线分发、迁移/备份恢复均继续执行；实际部署归档还检查Next生产页面含Antd App根节点与服务端收集的中文主题样式（业务控件在Suspense挂载后显示）。不连接生产ECS、RDS或OSS，本轮没有数据库迁移。

参考：[Ant Design官方Next.js接入](https://ant.design/docs/react/use-with-next/)。

最终结果：严格类型检查和Node22.21.1生产构建通过；隔离全量`npm test`为64/64通过、0跳过。最终清理旧全局控件CSS后，5/5 DOM交互测试再次通过，实际git archive→npm ci→构建→生产入口隔离启动→SSR主题样式检查亦单独复验1/1通过。未实际浏览器视觉验收，未部署生产。
