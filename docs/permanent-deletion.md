# 数据删除与级联清理（schema 6 / CLI 0.4.0）

本版本替代软删除。删除不是移入回收站：清理数据库中的目标记录、依赖关系、相关完整冻结快照与数据库可追踪的OSS原图/工作图/快照对象。删除原图时，跨数据集引用该原图的定位记录及相关整个快照包一并删除，其他歌曲可能因此失去旧快照，但其未引用的原图不会误删。删除定位数据集/记录只删除自己的标签与引用快照，不反向删除仍属于切图数据集的共享原图。对象key实际复用时，所有拥有同一对象的原图记录也纳入影响预览。

编辑器内删除区域、小节和事件属于普通标注 JSON 编辑，不调用本服务：操作立即在内存生效，保存前可撤销、重做；PUT 保存后仍保留原图、原始定位来源附件和已冻结快照。新框与已保存框使用同样的编辑语义。

本服务仍为 CLI 等显式清理请求保留 region/locMeasure/locEvent 类型：执行时会清理目标 JSON、历史恢复字段和引用快照；定位项还会清除原始附件中的对应项与关联关系。该专用清理与编辑器的标注编辑用途不同。

**升级迁移只新增清理任务表并扩展快照的专用删除通道，不自动清空旧回收数据、不重写已确认页、会话、CLI授权或旧快照内容。** 旧回收数据可在“历史待清理”视图手动永久清理。导入外部备份属于重新创建数据，不是平台恢复功能；部署备份、用户已下载的文件、离线副本、异地备份和数据库WAL不自动销毁。不会全桶扫描或清理数据库已无法追踪的旧孤立对象。

## 一致性和失败

PostgreSQL与OSS没有跨系统原子事务。流程为：

1. 预览读取目标版本、全部子项、定位引用、相关快照和精确对象key，保存短时计划；不会删除对象。
2. 用户确认不可恢复的影响范围，提交token与`acknowledged:true`。五分钟内有效；执行前重新计算并比对完整计划。版本/影响变化409，必须重新预览。
3. 持久化pending后，在数据库全局删除锁下清理OSS，再在单个SQL事务删除数据库依赖，最后写done并清空计划敏感细节，只保留任务ID/数量审计。两边全部完成才返回`deleted:true`。
4. OSS或数据库失败返回503，任务留在pending/failed，不显示成功。此时暂时暂停数据API（包括读写及导出），登录、授权和删除任务入口仍可用；清理服务启动后及每30秒自动重试，也可手动重试。无确认的planned任务不会自动执行。OSS删除幂等，已删除对象不会妨碍重试。
5. 数据写事务在BEGIN前取得共享锁，删除取得同一排他锁，防止清理中创建新引用；失败待清理状态禁止后续事务写入。正在生成的相关快照要求稍后重新预览，不边生成边删除。普通冻结内容仍不可修改，只有专用删除事务允许移除定位冻结快照。

已进入清理的任务不可取消。清理未完成会保留数据库追踪信息，并可能已有部分对象被删除；不要启动旧版本、手工清除任务或用备份覆盖现库。应修复权限/网络/数据库约束后重试。服务启动不会等大量清理全部完成才监听，管理界面保留重试入口。

## OSS最小授权补充

现有`oss:GetObject`、`oss:PutObject`、`oss:DeleteObject`及私有ACL不变。永久删除还需要：

- `oss:GetBucketVersioning`：Bucket资源`acs:oss:*:*:xianji-source`，用于读取版本控制状态。
- 若版本控制为Enabled或Suspended：`oss:ListObjectVersions`（Bucket资源；由管理员按支持的Prefix条件限制应用前缀）以及`oss:DeleteObjectVersion`（仅`acs:oss:*:*:xianji-source/omr/*`或实际子前缀）。

部署在迁移和切换前先只读检查GetBucketVersioning，版本化桶同时探测应用前缀的ListObjectVersions；读取权限不足则停止升级、保留旧服务，不创建清理任务。DeleteObject/DeleteObjectVersion不能通过无副作用探测验证，仍须由管理员核对。不会自动赋权、改Bucket版本状态、ACL、CORS、保留策略或白名单。权限不足/保留锁阻止删除时任务失败并保持待清理。未版本化桶正常删除；版本化或暂停桶分页列举精确key的全部版本与删除标记，逐版本删除并复查，不使用“加一个删除标记”冒充永久删除，不删除同名前缀邻居。每key最多100页/10000版本，超限明确失败。首次真实Bucket执行仍需用户在ECS验证授权和保留策略；本轮只测试模拟客户端。

官方参考：[ListObjectVersions](https://www.alibabacloud.com/help/en/oss/developer-reference/listobjectversions)、[DeleteObject](https://www.alibabacloud.com/help/en/oss/developer-reference/deleteobject)。

## API

所有接口使用原有同源Cookie/Origin或CLI Bearer规则；GET需data:read，其余需data:write，不接受无效/混合Bearer回退Cookie。

| 操作 | 路径 | 输入 |
|---|---|---|
| 影响预览 | POST /api/v2/deletions/preview | kind, ids, 可选regionIds |
| 明确执行 | POST /api/v2/deletions/execute | token, acknowledged:true |
| 失败重试 | POST /api/v2/deletions/:jobId/retry | {} |
| 待清理任务 | GET /api/v2/deletions | 无 |

kind：`dataset`、`song`、`page`、`region`、`locDataset`、`locRecord`、`locMeasure`、`locEvent`、`snapshot`、`locSnapshot`。ids为1–100个不同平台UUID。region/locMeasure/locEvent只允许一个页/记录UUID，并以regionIds传1–5000个稳定区域/小节/事件ID。其他类型不需要regionIds。预览单次级联最多10000张原图，相关正在生成的快照409。

示例预览：

```json
{"kind":"page","ids":["11111111-1111-4111-8111-111111111111"]}
```

响应：`{token,summary,irreversible:true,expiresInSeconds:300}`。summary含datasets/songs/pages/regions/measures/events/localizationRecords/snapshots/objects。用户确认后执行：`{token:"响应token",acknowledged:true}`。成功响应`{deleted:true,jobId,summary}`；重放已完成job只返回同一完成结果，不再次清理以后新建的数据。

旧datasets/songs/pages delete、所有旧软恢复端点、regions restore返回410，避免旧客户端仍以“可恢复”语义删除。普通 PUT 可移除区域、小节或事件ID并保存标注，且仍要求版本匹配；不执行快照和来源文件清理。`localization events reject/restore`只是候选状态切换，UI改称“撤销拒绝”，不是删除，保留既有契约。七个旧端点保留路由映射但不再执行写入。

## CLI（无需npm安装）

先升级平台。本地使用Node >=22.18：

```bash
node tools/cli/xianji-omr.mjs deletions preview --origin http://116.62.12.100:8790 --allow-insecure-http --input /tmp/delete-input.json > /tmp/delete-plan.json
# 检查上述影响数量后，显式执行。HTTP为明文传输，必须主动允许。
node -e 'const fs=require("node:fs");process.stdout.write(JSON.stringify({token:JSON.parse(fs.readFileSync(process.argv[1],"utf8")).token}))' /tmp/delete-plan.json | node tools/cli/xianji-omr.mjs deletions execute --origin http://116.62.12.100:8790 --allow-insecure-http --input - --acknowledge
node tools/cli/xianji-omr.mjs deletions list --origin http://116.62.12.100:8790 --allow-insecure-http
node tools/cli/xianji-omr.mjs deletions retry JOB_UUID --origin http://116.62.12.100:8790 --allow-insecure-http
```

`delete-input.json`使用上述API输入结构。原网页浏览器授权、origin隔离凭据、JSON stdout/错误stderr和退出码不变；execute没有`--acknowledge`退出2且不发送删除请求。旧恢复/删除命令返回HTTP410（退出6），新预览/执行发生冲突退出5。共54个路由模板映射，包括7个明确返回410的旧模板。

## ECS升级

```bash
git pull --ff-only && sudo bash deploy/deploy.sh --build-on-ecs
```

先核对上述OSS权限；不需要改变原RDS/OSS配置或新增凭据。脚本保留迁移前备份、版本化幂等迁移、原子发布与健康检查。schema6只允许兼容6的程序运行，失败不能强行启动旧schema5代码写新库。本轮不部署ECS，不执行生产删除。

## 本轮验证

Node 22.21.1生产构建通过；隔离PostgreSQL18和模拟OSS全量`npm test`为57/57通过（0跳过），包括数据库备份恢复、迁移、删除失败/持久化重试、并发版本、CLI真实子进程/离线包及部署归档安装启动。OSS版本化删除另外验证分页、删除标记、精确key和权限失败；未访问真实OSS/RDS或部署ECS。浏览器交互本轮未实测，不提供冒充实测的截图。
