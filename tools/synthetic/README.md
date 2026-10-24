云端移交与一键启动见 [CLOUD.md](./CLOUD.md)。

# 合成曲谱：先修复常规伴奏，再继续导入

默认入口已切换到 `audition195-accompaniment-v3`。每首仍生成 3 套：所有常规谱本改用 × 表示和弦内拨弦，扫弦主要显示方向箭头；每首至少两套以 × 伴奏为主。整体为 497 套 × 伴奏、59 套混合、29 套数字谱。经过音、击勾弦、滑音及其起点、明确要求显示品位的音继续使用数字，闷音语义保持独立；音高、弦号、节奏、歌词不变。原有 8 类记谱效果及随机字体、页眉、页脚、水印、脏污和边距继续保留。

停止旧进程后，在项目根目录重新运行原命令：

```powershell
node tools/synthetic/revise-audition.mjs --run
```

任务严格按三个阶段排序，不会在常规数据修复完成前进入后续阶段：

| 日志 phase | 内容 | 本轮队列 |
| --- | --- | ---: |
| repair-common | 替换已上传的常规谱本 | 157 套 |
| repair-existing | 按新比例修正其他已上传谱本 | 311 套 |
| continue-import | 继续剩余数据 | 117 套 |

如果上次 Ctrl+C 留下了上传或清理中的事务，会先恢复该事务，避免留下重复页，然后进入上述修复队列。每套新图及标注全部上传、回读并确认为“已确认”后，才清理本轮旧页并重排页序。原歌曲 ID、分组及 train/val/test 划分保持；谱本名称同步更新。检测到人工改动、额外页面或清理会影响快照时停止并保留数据。

新断点位于 `.artifacts/synthetic-renderer/audition-195-batch/accompaniment-revision-v3`。重复执行原命令会按新断点继续，已完成的修复不会重复导入。新流程有单进程锁；不要同时启动旧版任务。`--limit N` 限制本次处理套数，`--song SOURCE_ID` 仅处理指定歌曲，`--render` / `--upload` 可拆开运行。修改已开始上传的渲染规则需要新建修订版本，脚本会拒绝用不一致的渲染结果覆盖断点。

本地准备、对照预览和验证：

```powershell
node tools/synthetic/revise-audition.mjs --prepare --previews
node --test test/synthetic-accompaniment.test.mjs test/synthetic-layout.test.mjs test/synthetic-replacement.test.mjs
node --expose-gc tools/synthetic/verify-accompaniment.mjs
```

全量预检显示约 84% 的非闷音拨弦音符使用 ×。验证脚本逐套核对实际生成的 SVG 字符、方向标记与音乐事件数，报告保存在 `glyph-audit.json`；这不代替 PNG 的视觉验收。每页切图坐标仍在浏览器实际排版后计算，多排歌词继续按同一谱行合框，六线谱框继续采用紧致范围。

这些脚本依赖 `.artifacts/synthetic-renderer` 已有的源曲谱、制谱源码快照及依赖。在当前 Codex 执行环境中，网络连接返回 EACCES，Edge 渲染进程也无法启动；执行修复需要使用此前已成功运行任务的本机 PowerShell。

