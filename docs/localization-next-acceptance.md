# 云端验收记录：Next/TS + 几何定位 + 预构建部署

仅使用GPT云端仓库与隔离PG18/mock OSS，不访问真实ECS/RDS/OSS、原始语料或Mac。保留基线57226c4与AF_NETLINK。数据schema5、定位几何omr-localization-v1、原生快照omr-localization-snapshot-v1、裁片映射omr-localization-crops-v1、CLI0.3.0。

## 已执行

- `npm run typecheck`：strict通过，无忽略类型检查配置。既有API迁移TS保留部分显式any边界；新定位验证使用unknown解析和明确类型，不宣称所有历史边界已完全收紧。
- Linux x64 / Node22.21.1：`node server/build.mjs`真实生产构建通过，Next App Router列表/详情/编辑器均有实际pathname路由。
- `PATH=/tmp/omr-pg-tools/bin:$PATH OMR_RUNTIME_NODE=/tmp/omr-node22/node_modules/node/bin/node node --test test/*.test.mjs`：35测试，35通过，0失败。包含真实PG18、OSS故障模拟、迁移、授权/作用域、坐标、元信息、冲突、回收站、不可变快照/导出和归档启动。
- 根CLI真实子进程50模板；真实tar.gz解压到无私有依赖目录再跑同一50模板。上传file/stdin、定位原图映射、幂等、AI不自动确认、并发version、拒绝恢复、显式确认、选定recordIds冻结、原生/crops SHA校验通过。
- schema4→5：7页模拟人工确认、回收站、会话、CLI grant和旧快照逐行保持；重复迁移；真实pg_dump并pg_restore到独立库还原升级前状态。原schema2带数据逐级升级回归保留。
- 归档真实git archive → npm ci --omit=dev → build → Node22生产入口，隔离PG启动健康/schema5通过；所有路由直达200、未知页面/静态404、未知API返回JSON404；授权页Referrer-Policy恢复same-origin，Origin/CSRF与Bearer混合身份拒绝保持。
- `python3 test/config-pty.py`：隐藏输入、原子受限权限、幂等复用、Ctrl-C清理通过。
- `bash -n deploy/deploy.sh deploy/bootstrap.sh`及`git diff --check`通过。
- 预构建包校验测试：SHA错误、软链接、路径穿越拒绝；默认小内存不构建、备份在迁移前、AF_NETLINK、独立服务/内存限制保留。

实际standalone候选包已执行：`node test/artifact-smoke.mjs 包路径 SHA256 /Node22路径`，校验完整清单并在提取目录使用包内Next/TS API+独立PG/mock OSS及离线CLI再跑50模板。已从提取目录再跑50模板通过；最终匹配main的产物路径/SHA以交付消息为准。

## 浏览器实际操作

在隔离账号的`http://terminal.local:4173/`真实Next生产输出完成：数据集→歌曲→多页编辑器；HTTP画框；移动、缩放不改原图坐标；裁片筛选/回原图稳定ID关联；定位事件横拖、小数回读、六弦线拖动、撤销重做、保存刷新、人工确认、拒绝/恢复、点击补事件、画小节、未保存返回/后退取消。发现并修复HTTP crypto.randomUUID不可用、query只改URL不切视图、授权表单Referrer策略、图片异步加载旧图风险等问题。

浏览器授权页显示客户端/权限/有效期/HTTP风险，撤销隔离授权显示“已撤销”；网页审批回环跳转受云端浏览器URL策略/跨容器回环限制，不能声称浏览器完成了本地CLI listener换码。拒绝/PKCE/state/replay/过期/撤销与完整本地listener换码由真实CLI+API测试覆盖。没有读取或输入用户生产凭据。

截图由云端浏览器保存到任务交付文件，未把测试图片/fixture/凭据加入Git或生产包。

## 限制与部署注意

- 无生产部署、真实云资源联调或ECS内存压测；系统服务512MiB/heap256MiB只是资源限制，非已测吞吐承诺。用户首次升级后才算ECS/OSS/RDS实测。
- 当前历史坐标导入仅恒等矩阵；非恒等422，须迁移端显式转换并保留来源报告。原图字节不同须显式RGB等价证明；平台只核验自身RGB，历史图相等来自迁移端声明。
- 导入默认待复核；原始accepted/AI reviewed不转人工确认。不执行本地780份/22542轨道或272+24张真实图片迁移，不虚构独立金标数量。
- 快照批量上限100记录/3000小节/8MiB附件与几何JSON；裁片2亿像素/512MiB/20000张，用recordIds分批，不拆数据集。原生附件只读保全，不是音乐内容真值。
- 新定位模块不提供训练/推理、音乐内容编辑、模型管理或永久原图删除。原切图taxonomy和旧快照解释不变。
- 用户浏览器无本地草稿持久化：未保存仅在内存，保存失败/409不显示成功；离开提供保存/放弃/取消。刷新只有服务端保存内容可恢复。
- 预构建包锁定生产依赖，Linux x64/Node22；没有生产配置、凭据、测试fixture/本地语料，不是arm64包，不含Node二进制。ECS使用匹配commit的包，不默认next build。schema5不允许旧schema4 release强行回退写库。

兼容备份：React编辑器保留含工作图dataUrl的schemaVersion2手动备份及旧无类别导入；含图片导入新页并保存为draft，不覆盖原记录、不确认。无图片JSON仅可应用当前相同原图ID的内存草稿。没有IndexedDB或自动本地内容存储。

追加验收：原生快照导入另一定位数据集时，同时保留original附件与已调整geometry/稳定ID，全部确认重置为draft，不重复原图上传。冻结指纹可从下载JSON重新计算；裁片ZIP使用固定归档时间，失败重试后的字节和SHA一致。确认/冻结实际核验OSS原图字节SHA；对象存储失败不产生确认成功状态。事务对来源行加共享锁，避免曲组/split更新与冻结校验竞争。

浏览器手动备份闭环：真实点击导出按钮取得schemaVersion2/layout-v2且含工作图dataUrl的JSON文件，再通过文件选择器导入为新draft页；原记录保留。四角分别缩放并保存后，仅改动标题区域变为未复核，其余区域仍为确认无误。

最终浏览器限制：云端预览对根页面构建缓存存在滞后，旧hash完整自动迁移未在最终构建完成可靠浏览器验收；已覆盖显式归属解析/歌曲/谱页/裁片/筛选页码的路由测试、Node22直达HTTP与404测试，并强制非静态资源no-store防止升级后旧HTML缓存。旧hash捕获仅在内存，不持久化草稿。部署后需复验旧链接。实际pathname编辑、刷新、返回及未保存取消已验收。

幂等来源指纹按实际/历史SHA集合计算，不依赖平台UUID别名；同语料/revision映射到字节相同的另一UUID必须报409，不能制造第二份标签记录。
