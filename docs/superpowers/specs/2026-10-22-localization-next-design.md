# Next/TS 与小节事件几何定位

范围：用户明确授权同一云端仓库独立实现、自审、隔离验证后推送main；无子代理、无生产操作。保留57226c4不写浏览器草稿、历史切图/元信息/回收站/会话/CLI/冻结包。训练/推理/内容编辑均不在本轮。

## 架构与路由

单仓库Next App Router + React + TypeScript strict；同源Express API业务迁移TS，薄mjs兼容入口供既有部署/测试，独立CLI仍是Node内置模块。Next自定义同端口服务复用现有认证/Origin/scopes和PG池/OSS，不增加监听端口或降低安全规则。页面实际App Router路由：/datasets、/datasets/:id、/datasets/:id/songs/:songId/pages/:pageId；/localization/datasets、/localization/datasets/:id、/localization/datasets/:id/records/:recordId。query保存filter/page/view/measure/event等；旧hash解析后replace到pathname。路由守卫对未保存内容提示保存/放弃，取消不写新history；浏览器后退取消须恢复原索引，不插入重复条目。根页迁移旧深链，否则跳/datasets；未知页面404，API/静态错误不进入SPA首页。CLI授权页面路径与cookie-only审批保持。

新React组件按数据访问、路由守卫、任务导航、列表、布局编辑器、定位编辑器分解。旧JS界面不能作为唯一Next壳；核心API/校验和业务采用TS并纳入strict类型检查。

## 来源、schema5与导入

expand新增定位datasets、records、record_pages、snapshots，旧表/旧迁移校验和不改；部署锁内先真实备份、幂等事务迁移，失败停止。记录关联已有omr_images UUID，原图只存在私有OSS原key，不上传事件裁片当原图。保存原图SHA、像素SHA和坐标映射，引用必须匹配平台原图及曲组split；sourcePageMap把历史asset_id映射平台UUID。记录id与measure/event稳定ID独立，不以序号关联。

导入键=(定位dataset,历史sample_id,revision,sourceSha集合摘要)，相同键相同输入幂等返回，同revision不同原始输入报409；较新revision创建独立来源版本，不覆盖人工修改记录。原始语料完整保留只读附件，包含未知字段、label/relations/texts/AI证据/候选/拒绝/复核者；API原生导出同时返回原始附件和当前geometry，不能静默丢字段。所有历史accepted/geometry_reviewed只作为来源证据，导入定位确认状态为draft。拒绝状态保留且可恢复，不删除事件。

## 几何契约与确认

整页原图整数bbox xyxy，事件center_x/六弦线允许有限小数。草稿允许null未知几何；guitar/melody、voice、systemId、barNumber及稳定ID，事件以同小节同声部x严格递增为确认条件；拒绝候选排除确认约束但保留证据。小节框/边界、六线位置、事件中心与可选bbox/contextBBox均在原图坐标检查，父谱行上下文从现有标注引用，不伪造缺失几何。guitar确认须六根递增弦线，melody不强制六弦。必须显式人工完整性ack，几何确认不生成内容真值。变更只取消受影响measure几何/完整性确认；整记录确认随变更取消。原图不存在/删除/校验不匹配拒绝保存确认，快照冻结来源版本不可改。

API /api/v2/localization 命名空间：datasets list/create；dataset records list/import；record get/save/confirm/unconfirm；event reject/restore；dataset snapshots list/create；snapshot native/crops下载。写入均乐观version，确认data:confirm，普通写data:write、读取data:read。SQL参数化，同曲/图split继承原平台，不许客户端另选split绕过。完整导入schema和stdin/映射示例单独交付docs/localization-contract.md；不得从内容标签、候选数量推断几何。

编辑器：原图/谱行上下文、当前小节与事件裁片，画/拖/删小节、六根弦线调整、点击补事件/横移、拒绝恢复、裁片范围、页/小节导航、键盘1px微调及撤销重做；仅服务端保存，无IndexedDB。冻结导出当前确认几何和来源映射，原生JSON/逐图裁片ZIP校验SHA，资源限额，历史包不可变。

## 验收门槛

隔离PG18/mock OSS：schema4带已确认页/CLI/快照/回收站升5且幂等与真实备份恢复；导入映射/幂等/证据保全/AI不自动确认/来源校验/split隔离/并发冲突/确认失效/不可变导出与裁片哈希。旧全套测试、strict typecheck、Next build、原部署archive安装构建隔离启动。浏览器实际新旧列表/editor、定位几何操作、保存重开/撤销拒绝恢复、路由直达刷新前后退/query/404/旧hash/未保存取消历史。无真实云联调不得声称生产已部署。

## 小内存 ECS 与迁移清点补充

生产构建仅在云端完成，交付 Linux x64/Node22、锁文件生产依赖齐全的 standalone-v1 包及 SHA256。默认部署必须显式提供 --artifact/--sha256，校验文件、目标平台及checkout commit，安全解压后复用配置、备份、expand迁移和原子健康发布；不在1.8GiB ECS执行npm ci或Next build。源码构建仅显式--build-from-source且至少3GiB可用内存，构建worker=1、heap上限2GiB；生产独立服务512MiB限制/Node heap256MiB、AF_NETLINK和8787隔离保留。包不含配置、凭证、fixture、语料或模型。

用户清点272张真实原图、24张合成图，本轮不触碰这些真实数据。271张字节SHA匹配可直接映射；编码不同的1张须显式decoded-rgb-v1证明，记录平台/历史字节SHA及RGB SHA，平台核验自身RGB，历史RGB相等由迁移端显式声明，不将其冒充平台独立验证。原图坐标导入当前仅支持恒等historical coordinate_mapping，非恒等422整笔拒绝，需迁移端显式转换并保留原附件；不猜缩放。现有7页人工确认不重置。
