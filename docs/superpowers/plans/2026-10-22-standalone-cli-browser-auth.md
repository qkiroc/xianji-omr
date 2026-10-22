# 仓库内独立 CLI 与浏览器授权实施计划

日期：2026-10-22。状态：已获复核批准并实施；下列进度按实际验证维护，最终记录见 docs/verification-standalone-cli.md。

依据：[最终设计](../specs/2026-10-22-standalone-cli-browser-auth-design.md)。云端目录 `/workspace/scratch/82acab135f2b/repository`，基线main `577227efe4689472e6c1701909e3da1dac562a00`。当前可用技能目录没有writing-plans技能，本计划按其所需的具体文件、逐步验证与交付格式编写，不声称调用过该技能。不新增任务、MCP、npm包、workspace或发布流程；现有npm依赖和服务器构建保留。

## 实施摘要

- Goal：提供直接Node运行、完整覆盖24业务模板的独立CLI与可撤销浏览器授权。
- Architecture：CLI只依赖Node内置模块；同源网页Cookie审批，业务Bearer逐请求鉴权；PG存hash与状态机，原图/快照仍在私有对象存储。
- Tech Stack：Node >=22.18.0 ESM、原有Express/pg/PostgreSQL18、原生HTML/JS；tar.gz离线源码，无npm包/MCP/workspaces。
- Spec：[最终设计](../specs/2026-10-22-standalone-cli-browser-auth-design.md)。
- Global Constraints：仅GPT云端；不访问用户Mac或生产资源；不强推；HTTP须明确允许；不输出凭证；AF_NETLINK与8787服务保持。

### 当前完成项

- [x] 授权请求/审批/换码/撤销与schema3，Cookie/Bearer/Origin/scope边界。
- [x] 独立Node入口与24路由真实调用，file/stdin、version冲突、确认与校验下载。
- [x] 离线tar.gz干净目录完整集成，原git archive安装/构建/生产入口隔离启动。
- [x] 浏览器审批/拒绝/撤销和标注保存重开；跨容器回环限制单列，不声明完整浏览器回环通过。
- [x] 修复有界限流与业务--version缺值；浏览器原生表单Referrer-Policy/Origin回归。
- [x] 最终全量19项通过，脱敏/范围检查与交付摘要完成；提交后核对main SHA与文件树。

关键协议示例：POST /api/cli-auth/requests 带 S256 challenge/state/redirectUri；用户通过原生同源表单POST decision后303精确回环；CLI POST token只发送一次性code/verifier/redirectUri；业务PUT /api/v2/pages/:id带version与layout-v1 boxes。未confirm不得纳入训练。

## 文件边界

| 文件 | 职责 |
|---|---|
| tools/cli/xianji-omr.mjs | Node入口、退出码、信号清理；shebang |
| tools/cli/src/version.mjs | 独立CLI版本常量 |
| tools/cli/src/commands.mjs | 24业务模板与规范命令/别名/权限描述，只保留客户端契约 |
| tools/cli/src/input.mjs | 参数、JSON文件/stdin上限、必需字段、原图字节/MIME |
| tools/cli/src/http.mjs | origin校验、Bearer客户端、manual重定向、超时、JSON上限 |
| tools/cli/src/download.mjs | 流式part/哈希/长度/不覆盖的原子发布 |
| tools/cli/src/credentials.mjs | origin隔离、权限检查、锁、原子本地保存/清除 |
| tools/cli/src/auth.mjs | state/PKCE、精确回环listener、浏览器打开与换码/撤销 |
| tools/cli/README.md | Node直接运行、本地Codex使用、HTTP风险、命令/退出码/配置路径 |
| tools/package-cli.mjs | 仅白名单CLI源码打tar.gz，清单与SHA256，不进生产入口 |
| server/migrations/003-cli-authorization.sql | 请求/grant新表、约束与索引，expand迁移 |
| server/src/cli-auth.mjs | 授权状态机、输入/限流、PKCE、hash、cookie-only/Bearer-only生命周期 |
| server/src/identity.mjs | cookie/Bearer身份、scope、credential hash，供app路由使用 |
| server/src/app.mjs | 公共安全规则、授权挂载顺序、业务身份/权限；网站登录语义保留 |
| server/src/platform.mjs、pages.mjs | 精确下载哈希/长度头；不以最近列表作为下载前提 |
| server/src/migrate.mjs、server/compatibility.json | schema3声明及健康/回退兼容 |
| web/cli-authorize.html、web/cli-authorize.js | 无第三方依赖的授权/拒绝、未登录站内返回、原生表单303 |
| web/cli-grants.html、web/cli-grants.js、web/index.html | 查看/revoke当前用户CLI授权、入口；复用styles.css |
| test/cli-auth.test.mjs | 真实PG/API授权/身份/迁移/Origin/并发测试 |
| test/cli-routes.test.mjs | 从Express实际路由提取method+完整路径，与command-map双向比较 |
| test/cli.test.mjs | 实际子进程CLI完整API流程，可切换离线入口 |
| test/cli-download.test.mjs | 故障流、文件竞争/完整性、大流内存与安全重定向 |
| test/cli-distribution.test.mjs | 真实tar.gz、白名单、干净复制安装零依赖、共用真实API套件 |
| test/cli-browser.mjs | 仅隔离授权验收桥接：临时CLI流程/回调，不含生产自动授权 |
| test/deploy-archive.test.mjs | 真实git归档内容、原生产安装/构建/启动与模拟故障兼容 |
| test/fixture.mjs、test/integration.test.mjs、test/layout.test.mjs | 扩展隔离fixture与schema断言，保留既有行为验证 |
| docs/verification-standalone-cli.md、README.md、deploy/README.md | 最终实测证据、HTTP/迁移限制、运行与升级命令 |

允许按实现发现合并少量同职责文件，但不能把服务运行时依赖指向tools/cli或把CLI反向依赖server。无需为每个纯函数建立镜像单元测试，优先真实协议与故障边界。

## 步骤1（已完成）：基线与测试框架

1. `git status --short`、`git fetch origin main`、核对默认分支及本地/远端差异；有用户修改保留，远端更新安全整合，不reset/force。
2. 核对24路由、现有cookie Origin规则、003迁移序列、静态文件构建与git archive边界；记录不修改旧SQL checksum。
3. 在cli-routes测试实现实际Express路由递归提取，先与24项固定期望断言，再建立客户端command-map双向覆盖；用临时注册的未映射route验证检查器确实失败。不要仅比较两份手写清单。
4. fixture支持隔离schema2升级schema3及临时账号；新CLI测试固定独立端口或由测试动态分配，不碰4173预览与既有PG端口。服务端测试有依赖，CLI子进程无私有依赖。

验收：`node --test test/cli-routes.test.mjs`。此阶段允许新授权测试先红，不能把预期失败记成通过。

## 步骤2（已完成）：授权后端与迁移

1. 写003、更新schema/兼容声明和原测试schema期望；带原图、框、会话、ready快照的schema2隔离库升级两次，验证原数据和旧SQL校验值。
2. 写精确callback/origin/S256/scopes/长度校验、有界限流、hash存储、5分钟请求/60秒码/30天grant；事务状态转移及并发单次消费。
3. 挂载公开request/token端点在cookie-only守卫前，保留公共安全头；decision用受限urlencoded原生表单、cookie-only+Origin，303仅到记录内精确回环URI。
4. 实现cookie/Bearer明确分流、无效Bearer不回退、混合身份拒绝、权限逐路由检查；网站login/logout/session不能使用Bearer。实现grant列表/撤销和self状态/撤销，不增加password CLI流程。
5. 测试批准/拒绝/过期/replay/wrong PKCE/state/redirect及并发、credential变化、scope不足、origin缺失/错误、限尺寸/限流；未批准不签token、DB只存hash。

验收：`node --test test/cli-auth.test.mjs test/cli-routes.test.mjs`，再运行 `PATH=/tmp/omr-pg-tools/bin:$PATH npm test`（该路径仅当前云端隔离PG客户端，非ECS依赖）。

## 步骤3（已完成）：可直接运行的授权CLI与网页

1. 写version/入口/help、stdout JSON与stderr错误及稳定退出码；Node版本检查，无自定义包安装。
2. 写origin隔离凭据存储、权限/符号链接检查、独占锁、同目录wx/fsync/rename；Windows限制准确写文档。
3. auth绑定127.0.0.1随机端口、固定callback，生成state/verifier/challenge；POST请求后自动打开同origin授权页面（无shell）。外部浏览器不可用时输出授权URL供用户打开，仍要求点击批准。
4. 网页复用现有登录，returnTo严格站内白名单；展示权限/期限/设备，原生form批准/拒绝；增加已授权CLI列表与撤销入口，不改变标注主流程。
5. 实际入口测试恶意state/Host/路径、合法拒绝、错误/重复换码、超时/Ctrl-C清理、磁盘失败回收、status/revoke/forget及origin独立HTTP选择。测试用隔离专用用户模拟审批，不调用生产。

验收：`node tools/cli/xianji-omr.mjs --help`、`node tools/cli/xianji-omr.mjs --version`、`node --test test/cli-auth.test.mjs test/cli.test.mjs`。无secret stdout/stderr扫描必须同时覆盖成功和异常。

## 步骤4（已完成）：全部业务命令与流式下载

1. command-map驱动24规范命令，file/stdin有界JSON，图片真字节上传；保持服务端返回字段，不编造删除/分页。
2. PUT必须由用户输入version，409稳定非零且不自动重试覆写；annotations save仅别名，confirm必须显式version+acknowledge。
3. HTTP默认远程HTTPS；显式允许HTTP仅对应origin；不跳过TLS证书、不跟重定向、不输出Bearer；abort覆盖上传/JSON读取/下载。
4. 下载先创建受限part，流式哈希/长度核验，无覆盖原子发布；精确snapshot响应头作为下载校验来源，不强制列表命中；页/原图从精确图片元信息校验。服务端取得流之后再设置成功头。
5. 真实API子进程流程：创建数据集/曲目、图片上传/读取、legacy normalize、保存父子框、version并发冲突、confirm/unconfirm、快照create/retry、两包下载并调用现有tools/validate-export.py。故障流测试损坏/截断/缺hash/重定向/目标竞争/中断，不只测正常小文件。
6. 创建超过最近30条窗口的快照样例，旧ready快照直接下载通过，list中不存在它不能成为CLI失败理由；不改变现有list上限。

验收：`node --test test/cli-routes.test.mjs test/cli.test.mjs test/cli-download.test.mjs`。大文件通过可重复流生成与临时文件测试，记录RSS/文件字节数，不使用真实谱图数据。

## 步骤5（已完成）：离线分发与部署归档兼容

1. 实现 `node tools/package-cli.mjs --output /tmp/xianji-omr-cli-dist`，输出带独立版本的tar.gz及清单/SHA256；显式白名单，仅tools/cli源码与README，不打包打包器自身/测试/凭据。
2. distribution测试调用真实打包器，解压到repo外临时目录、以该目录为cwd，使用独立HOME/XDG_CONFIG_HOME且清除NODE_PATH等注入；检查所有非node:导入都落在离线目录内。运行与源码入口相同的全部CLI真实API集成套件。服务端fixture由测试宿主启动，CLI不导入它。
3. 不创建package.json/workspaces/发布workflow，不要求npm login/install自定义CLI包；检查diff没有误引入这些文件或配置。
4. deploy-archive测试在隔离git临时检出中归档待测代码（避免使用只含旧HEAD的假验收）；使用与deploy相同路径清单，执行原 `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`、`npm run build`，对隔离DB/mock存储启动应用验证网页/API/schema。原production入口通过已有可注入依赖/隔离入口验证，禁止拿真实配置启动。
5. bash语法、原备份/迁移失败/原子切换回退测试保留；schema3失败不回退不兼容schema2代码写库。AF_NETLINK文本断言与服务单元diff核对。

验收：`node --test test/cli-distribution.test.mjs test/deploy-archive.test.mjs`、`npm run build`、`python3 test/config-pty.py`、`bash -n deploy/deploy.sh deploy/bootstrap.sh`、`git diff --check`。

## 步骤6（已完成验收，提交交付）：浏览器闭环、证据与推送

1. 使用现有受管云端预览启动隔离服务及测试账号。按浏览器工具限制操作授权页：允许、拒绝、查看grant、撤销；CLI回调由test/cli-browser.mjs桥接临时CLI流程，真实用户批准按钮必须实际点击，不能用测试后门冒充浏览器流程。
2. 回归网页原图编辑/保存重开，确认新路由/安全中间件没有破坏cookie Origin校验。截图不含token/code/verifier或配置。回环分属容器若造成真实回调不可达，明确报告浏览器限制，测试桥接必须标记模拟，不把后端换码等同跨设备实测。
3. 全量 `PATH=/tmp/omr-pg-tools/bin:$PATH npm test`；运行离线打包、独立解压入口测试；记录实际命令/通过数/失败修复、下载校验与大流RSS、浏览器证据和未实测平台。
4. README写直接Node运行与安全HTTP示例：`node tools/cli/xianji-omr.mjs auth --origin http://116.62.12.100:8790 --allow-insecure-http`（仅给用户运行，不在云端对生产执行）；说明本地Codex可直接调用、配置位置、授权撤销、退出码及源码/离线包运行方式。
5. deploy/README更新003迁移及schema3回退注意；不新增配置密码/AK输入，不变更生产实例。写docs/verification-standalone-cli.md，准确区分集成/浏览器/生产/跨操作系统证据。
6. fetch最新main、安全整合，受影响检查通过后commit/push main，禁止force/PR/外部部署。扫描提交无凭据/数据/临时包；离线包作为任务交付文件而非提交二进制。最终提供main SHA、文件路径、离线包与SHA256、验收结果/限制和现有ECS升级命令。

用户已明确通知开始实施；持续验证修复并交付功能，不停留在文档阶段。
