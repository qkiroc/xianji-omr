# 在云端继续制作合成曲谱

源数据、渲染源码快照和断点已经打包为 `assets/synthetic-cloud/` 下的 AES-256-GCM 加密素材。公开仓库只保存密文及校验索引；解密密钥和平台 CLI 凭证不在 Git 中。包内保留 195 首源曲谱、原始谱本配置、已上传页面的 ID/版本/校验值，以及中断事务需要的图片。

在原来这台电脑的项目目录执行一次：

```powershell
node tools/synthetic/configure-cloud.mjs
```

该命令在需要时安装 GitHub CLI、打开 GitHub 登录，随后通过标准输入将本地素材密钥与已有平台授权保存为仓库的 Actions Secrets，并启动 `Synthetic corpus` 工作流。密钥和凭证不会出现在命令参数或输出里。GitHub 连接器没有写入 Secrets 的工具，因此这次配置需在本机终端完成。

如果浏览器显示 `Authorize your device`，验证码就在启动登录的 PowerShell 窗口中，格式通常为 `XXXX-XXXX`。复制终端的 one-time code 到浏览器，保持终端打开直至登录完成；这里不需要申请 Personal Access Token。GitHub 配置与 OMR 配置在脚本中分别读取。

[查看云端工作流](https://github.com/qkiroc/xianji-omr/actions/workflows/synthetic-corpus.yml)。进入运行状态后，本机无需保持开机。停止本机旧任务后再移交，避免两边同时写入同一批页面。

云端在 Ubuntu 上安装 Node 22、固定版本的渲染依赖、Chromium 和中文字体。先恢复未完成的上传事务，然后按下列顺序执行：

1. `repair-common`：修复已上传的常规谱本，改成 × 拨弦、箭头扫弦。
2. `repair-existing`：按新比例修正其他已上传谱本。
3. `continue-import`：继续剩余谱本。

每首仍为 3 套，整体约 85% × 伴奏、10% 混合、5% 数字谱。保留原有歌曲分组、集合划分和“已确认”状态；需要明确品位的过渡音和技法继续使用数字。新图片及标注回读通过后才清理对应旧页。恢复云端已完成的记录时会核对远程校验值、版本和复核状态；旧断点与线上数据不一致时会停止，避免重复导入。

每轮最多运行约 300 分钟，随后加密保存断点；启用 `auto_continue` 时会自动启动下一轮。新启动的工作流会优先恢复最近的 `synthetic-checkpoint` Artifact；也可通过 `resume_run_id` 指定旧运行。断点 Artifact 保留 30 天，里面只有加密数据。强制取消任务后，可在 Actions 页面重跑；未完成事务按断点继续。

手动配置时需要以下 Repository Secrets：

| 名称 | 来源 |
| --- | --- |
| `OMR_ASSET_KEY` | 原电脑 `.artifacts/cloud-secrets/material-key` |
| `OMR_CLI_TOKEN` | 原电脑已授权的 OMR CLI，由配置脚本读取 |

迁移包重建：`node tools/synthetic/pack-cloud.mjs`。只有在本地制作任务已停止、断点稳定时重建，并同步更新 GitHub 上的加密素材。不要把 `downloads/` 或 `.artifacts/cli-config/` 作为明文素材提交。

也可在其他 Linux 云主机恢复：配置上述私密环境变量，执行 `node tools/synthetic/bootstrap-cloud.mjs`，在恢复后的 `.artifacts/synthetic-renderer` 内 `npm ci --ignore-scripts`，安装 Playwright Chromium 与中文字体，最后执行 `node tools/synthetic/revise-audition.mjs --run --cloud`。GitHub Actions 工作流给出了完整的安装顺序。


A push to `main` normally runs verification only. A maintainer commit containing `[resume-synthetic]` also resumes production from the newest encrypted checkpoint, using the existing repository Secrets. This permits a deployed repair to continue an interrupted cloud batch.

Annotation repair tightens numbered-notation regions to visible note artwork and omits original-key labels. Existing editions keep their pixels and page IDs; every annotation write is version checked, confirmed, and checkpointed. Untracked original tail pages can be removed only when their filename/checksum matches the original render catalog and their draft or synthetic confirmation state is untouched.

The v2 annotation repair uses actual SVG glyph ink, includes melody barlines and repeat/end marks, and separates only empty crop padding. Real ink intersections stop validation. Six regression songs are rendered in all three editions before any corpus changes. The independent glyph-geometry workflow has no OMR CLI credential and only verifies rendering. Existing production runs finish and save their checkpoint before a queued revision resumes.

Checkpoint reconciliation now compares canonical full annotations, including coordinates, classes, metadata, parent links and reading order. A version-only change is adopted only against a stored annotation hash or a pixel-matching historical renderer baseline. Modified pages remain untouched and appear in preservedPages with page IDs and reasons; other pages continue. Annotation saves still use current versions and concurrent write conflicts are preserved. Completion with preserved pages is reported separately.

Transient read failures (408/425/429/500/502/503/504 and network errors) use bounded exponential backoff. Non-rate-limited writes are not blindly replayed: an ambiguous failure saves a paused checkpoint and resumes through remote readback on the next runner. Three consecutive service pauses are allowed before stopping. Authentication, permission, and version conflicts never use this retry path. Logs identify request method/path and verification progress.

Replacement conflicts are now isolated at edition scope across original-page preflight, upload, cleanup, reorder, rename, and interrupted legacy/accompaniment recovery. A conflict persists a terminal preserved transaction with exact expected/actual metadata, page IDs and failed phase; later runners skip it. Completed counts exclude preserved editions. Actions summaries list preserved editions for review, and the final status distinguishes completion with preserved editions. Unknown errors, invalid renders, authentication and permission failures still stop the job. No forced overwrite or deletion is used to resolve conflicts.

New pages are checked again before cleanup, and old/new pages are reread after deletion preview; the platform also validates the deletion preview version at execution. An interrupted pristine upload can be adopted by exact filename/pixels and untouched state; changed drafts are preserved. Encrypted checkpoints include all conflict records while omitting terminal preserved render artifacts.
