# 实施计划

Goal：真实Next/TS独立URL + 原图引用几何定位闭环。Spec：[设计](../specs/2026-10-22-localization-next-design.md)。Tech：Node22.18+、Next App Router/React/TS strict、pg18、OSS、现有Express安全边界；单仓库零新增CLI依赖。Constraints：仅云端，无子代理/生产/强推，不覆盖远端历史。

- [x] 核对main/工作区，锁定依赖和Next/TS配置，迁移API核心TS保留兼容入口；npm run typecheck。
- [x] schema5 expand及定位types/验证/来源映射/导入/保存/确认/拒绝恢复；test/localization.test.mjs真实PG/mock验证。
- [x] 定位冻结原生/ZIP映射导出、CLI映射命令与完整stdin schema文档，真实入口/离线包全路由覆盖。
- [x] app各独立pathname页面、共享API/导航守卫/hash迁移、真实React原布局编辑/裁片及定位编辑器，移除单app巨型状态脚本依赖。
- [x] 生产同端口Next集成、部署archive包括Next应用/config/manifests，PG备份恢复与旧模块回归。
- [x] 浏览器新旧闭环、直接路由/历史/query/404/取消离开及截图；修复实际失败。
- [x] 全量测试+strict类型+Next build+deploy archive+脚本检查；自审权限/坐标/证据保全；更新验收和限制，安全fetch整合/commit/push main并核对SHA。

执行命令：npm run typecheck；npm run build；PATH=/tmp/omr-pg-tools/bin:$PATH npm test；python3 test/config-pty.py；bash -n deploy/deploy.sh deploy/bootstrap.sh；git diff --check。每个模块先运行针对性集成，再在最终运行全量，不以HTTP代替实际浏览器验收。

补充：默认部署使用Linux x64/Node22 standalone预构建包，SHA/manifest/commit校验；源码构建仅显式允许且>=3GiB可用内存。新增deploy/build-artifact.mjs、deploy/artifact.mjs、test/artifact-smoke.mjs，产物不入Git。真实打包/提取目录50模板与最终SHA由交付消息记录。原生导入可选geometry，严格版本/来源核验后撤销人工确认，原始附件保全。浏览器已发现并修复HTTP随机ID、query视图、Referrer策略、旧图加载、并发保存保护；回环审批回调限制明确保留。

验收记录：[实际结果与限制](../../localization-next-acceptance.md)。生产包使用包内依赖在提取目录对接真实隔离PG/mock OSS，离线CLI50模板通过；最终main SHA和对应包SHA在交付消息中核对。旧hash最终浏览器验收受预览缓存限制，解析及直达/404回归已覆盖；不宣称已生产联调。
