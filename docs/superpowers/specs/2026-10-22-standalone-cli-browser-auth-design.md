# 仓库内独立 CLI 与浏览器授权设计

日期：2026-10-22。状态：待修订复核，**尚未开始实现**。基线 main `577227efe4689472e6c1701909e3da1dac562a00`。

本文替代 [此前 npm/workspace 设计](2026-10-22-cli-browser-auth-npm-design.md)，保留其已复核的授权、业务覆盖与数据保护契约。最终范围为仓库内独立 CLI，不新增 npm 包、workspaces、多包管理、发布 workflow、npm 登录或 MCP 服务。现有根 package.json、Node 后端 npm 依赖和 server/web 位置保持；不引入 SDK、训练或模型业务。

开发与隔离测试仅在 GPT 云端 `/workspace/scratch/82acab135f2b/repository` 进行；不访问用户 Mac、不连接生产 ECS/OSS/RDS、不影响弦记8787，不申请或配置证书。本阶段只提交设计和计划，等待明确实施通知。

## 1. 独立源码与交付边界

入口 `tools/cli/xianji-omr.mjs`，支持 `node tools/cli/xianji-omr.mjs ...`，shebang 为 `#!/usr/bin/env node`；仅依赖 Node >=22.18.0 内置模块，独立版本常量放在 `tools/cli/src/version.mjs`。相对ESM导入只指向同一分发目录，不导入server/web、不读取项目 node_modules、环境中的私有服务配置、OSS或数据库配置，不使用自定义npm安装。

模块按命令映射、参数/输入、HTTP/下载、凭据、回环授权拆分，具体文件与测试见 [实施计划](../plans/2026-10-22-standalone-cli-browser-auth.md)。保留现有仓库许可；若无适用许可不擅自添加开源授权。

交付可直接复制的 tools/cli/ 目录及仅含该目录源码/README的 tar.gz。离线包有版本、清单与SHA256，不能含node_modules、服务器代码/配置、凭据、数据、图片或模型。构建打包脚本使用显式文件白名单，并在干净临时目录解压验证。离线指无需下载自定义CLI依赖；业务操作仍需连平台API。Node运行时由用户提供。

## 2. 业务路由到命令覆盖表

以下24项按 HTTP method + route template 计数，来源为基线 app.mjs、datasets.mjs、pages.mjs、platform.mjs；`:kind` 是一个模板，命令同时覆盖 detection/crops。命令前缀统一 `xianji-omr`。update 使用 PUT，不提供后端不存在的 delete 或分页选项。

| # | method + API template | 命令 | 输入/输出要点 |
|---|---|---|---|
| 1 | GET /api/v2/taxonomy | taxonomy | 原样JSON类别版本 |
| 2 | GET /api/v2/datasets | datasets list | 原样JSON列表 |
| 3 | POST /api/v2/datasets | datasets create --input FILE或- | name/description |
| 4 | PUT /api/v2/datasets/:datasetId | datasets update ID --input FILE或- | 必须含version |
| 5 | GET /api/v2/datasets/:datasetId/songs | songs list --dataset ID | 曲目列表 |
| 6 | POST /api/v2/datasets/:datasetId/songs | songs create --dataset ID --input FILE或- | name/songGroupKey/split |
| 7 | PUT /api/v2/songs/:songId | songs update ID --input FILE或- | 必须含version及服务端必需字段 |
| 8 | POST /api/v2/songs/:songId/pages | pages upload --song ID --file IMAGE | 真正图片字节/真实MIME/文件名 |
| 9 | GET /api/v2/songs/:songId/pages | pages list --song ID | 保留服务端页序 |
| 10 | GET /api/v2/pages/:pageId | pages get ID | image + boxes |
| 11 | GET /api/v2/pages/:pageId/content | pages content ID --output PATH [--original] | 默认工作图；original=1取原图 |
| 12 | POST /api/v2/pages/:pageId/normalize | pages normalize ID --version N | 显式变更；不自动执行 |
| 13 | PUT /api/v2/pages/:pageId | pages update ID --input FILE或- | version/annotationFormat/boxes/pageType及可选songId/pageOrder |
| 14 | POST /api/v2/pages/:pageId/confirm | pages confirm ID --version N --acknowledge | acknowledged=true，仅本命令可确认 |
| 15 | POST /api/v2/pages/:pageId/unconfirm | pages unconfirm ID --version N | 显式取消确认 |
| 16 | GET /api/v2/datasets/:datasetId/snapshots | snapshots list --dataset ID | 当前服务端最多30条，不虚构分页 |
| 17 | POST /api/v2/datasets/:datasetId/snapshots | snapshots create --dataset ID | 返回202及ID，不伪称已完成 |
| 18 | POST /api/v2/snapshots/:snapshotId/retry | snapshots retry ID | 同一冻结清单 |
| 19 | GET /api/v2/snapshots/:snapshotId/:kind | snapshots download ID --kind detection或crops --output PATH | 流式ZIP+SHA256 |
| 20 | GET /api/images | legacy images list | 兼容读取，现有最多500条 |
| 21 | POST /api/images | legacy images upload --file IMAGE | 兼容旧上传，结果仍是legacy |
| 22 | GET /api/images/:id | legacy images get ID | 原无类别框 |
| 23 | GET /api/images/:id/content | legacy images content ID --output PATH | 原图字节 |
| 24 | PUT /api/images/:id | legacy images update ID --input FILE或- | version/boxes；新版标注仍拒绝旧写入 |

可提供 `annotations save PAGE --input FILE或-` 作为 pages update 的严格别名：不隐式确认，不读取后写回最新版绕过冲突，不将无类别框转换为真值。图片上传别名只是 pages upload，不产生额外API。禁止“一个万能raw请求”代替命令覆盖。

实施时建立机器可读 command-map：每个模板标记唯一规范命令及参数编码，别名单独记录。覆盖测试从实际注册的 Express router（包含挂载前缀）提取 GET/POST/PUT 等路由，过滤内部自动HEAD，并对**全部**业务模板与map做双向集合相等检查，防止新增模板遗漏及陈旧/虚构模板。排除网站 login/logout/session、health、release接口以及显式列出的新授权生命周期接口；排除项用确切模板和理由维护，禁止按宽泛 `/api/*` 排除。逐项调用真实隔离API，download的两kind分别断言。现有服务端响应命名不被CLI随意改写。

## 3. 专用授权交互

`xianji-omr auth --origin URL [--allow-insecure-http]` 是公开客户端授权流程，无client secret，不接收平台密码，不读取浏览器cookie。自动用操作系统浏览器打开命令（macOS open、Windows系统浏览器、Linux xdg-open；spawn参数数组、无shell拼接）；云端/无浏览器时输出可人工打开的同一授权页面URL并等待，不能自动给真实用户批准。重定向浏览器只传请求ID，不携带Bearer/PKCE verifier。

1. CLI校验origin，生成crypto随机 state（32字节）、PKCE verifier（32字节base64url，43字符）及S256 challenge；固定使用S256。生成回调服务，仅 `127.0.0.1` 随机系统分配端口，固定路径 `/cli/callback`；首版不启IPv6，绝不绑定0.0.0.0。
2. listener成功绑定后向平台创建pending请求，提交完整redirect_uri、state、challenge、S256、客户端名称/设备说明与请求scope。设备说明是显示文本，不是可信设备身份证明。请求上限5分钟，CLI内存保存verifier，不落盘。
3. 浏览器打开平台 `/cli/authorize?request=随机ID`，复用原有网页登录。未登录时保留受限站内授权路径，登录后返回；不能接受任意returnTo跳转。页面显示平台、客户端/设备说明、权限、30天有效期及“授权”“拒绝”，不能GET自动批准。审批前后由cookie-only API核验现有用户与当前credential hash。
4. 用户以浏览器原生同源POST表单（非fetch）明确批准后，服务端在事务中使pending变为approved，生成60秒单次授权码（随机32字节），仅存hash，并绑定用户、credential hash、redirect_uri、state、challenge及scope。通过303跳转到精确回调URI，query仅含code/state；拒绝时带 `error=access_denied` 和state，不发码。服务端回调地址来自已验证记录，不接受批准表单重新指定。
5. listener只接受GET及固定路径，严格校验Host为 `127.0.0.1:分配端口`、来源socket回环、参数无重复、state恒时比较、code格式。错误state/路径/Host不换码、不结束合法等待；限请求数量和时间以避免无限耗用。合法拒绝立即退出；合法code只处理一次，后续请求不再次换码。
6. CLI通过平台JSON POST换码：code、verifier、精确redirect_uri。服务端用hash定位记录，行锁/条件更新保证单次消费，并校验未过期、PKCE及credential hash有效；错误PKCE不签token，限制尝试次数，重复使用一律失败。成功事务中标记consumed并生成专用Bearer（随机32字节加固定辨识前缀），仅返回一次明文。网络响应丢失不允许重放取得token，重新auth。
7. CLI原子保存凭据后，回调页只显示完成/失败，不输出token/code/verifier。成功、拒绝、超时、Ctrl-C、换码失败、磁盘失败都在finally关闭listener，清理timer与临时文件。磁盘写失败时尽力撤销刚发token，不能显示授权成功；撤销未成功时告知可在网页登录撤销，不泄露token。

本机恶意程序可能抢占/探测回环，PKCE/state减少码窃取及响应注入风险，不声称能抵御已控制用户账户/设备的攻击者。批准页面展示信息供用户辨认，不能承诺认证设备名称。

## 4. 新授权接口及身份边界

命名在实施时按此契约建立，不计入现有24个业务模板：

| 接口 | 身份与约束 | 结果 |
|---|---|---|
| POST /api/cli-auth/requests | 未登录CLI，JSON<=4KB，严格字段；无Origin可用，若有Origin须匹配平台，限流 | requestId/平台authorize URL/expiresAt；不含秘密 |
| GET /cli/authorize | 同源网页shell，登录交互 | 登录后显示明确审批 |
| GET /api/cli-auth/requests/:id | cookie-only，拒绝Bearer替代，限流 | 未过期请求公开显示信息，无code/hash |
| POST /api/cli-auth/requests/:id/decision | cookie-only + 原有精确Origin校验，原生表单urlencoded<=4KB | approve/deny，303到已验证回环URI；无重复批准 |
| POST /api/cli-auth/token | 无cookie依赖的PKCE交换，JSON<=4KB、严格Origin规则、限流 | token、grantId、scope、expiresAt；no-store |
| GET /api/cli-auth/grants | cookie-only | 当前用户grant元信息，不含token/hash |
| POST /api/cli-auth/grants/:id/revoke | cookie-only + Origin | 撤销当前用户指定grant，幂等 |
| GET /api/cli-auth/self | Bearer-only | 安全的grant状态/权限/到期时间 |
| POST /api/cli-auth/self/revoke | Bearer-only | 撤销自己；可据此清除本地配置 |

decision使用原生表单导航接收303，从而避免fetch跟随回环地址造成跨源响应问题；它只接受严格的approve/deny及request标识，仍校验Origin。其余写授权API使用受限JSON。请求/换码端点在全局cookie-only middleware前挂载，仍经过公共安全头、方法/Origin和限流检查。建议默认每IP创建10次/10分钟、交换30次/10分钟，另每请求错误交换最多5次；单进程有界桶，过期清理，应用在真实直连部署下按socket IP计数，不盲信X-Forwarded-For。pending/授权码也设全局容量上限（例如1000活跃请求），不能无界插入。

现有业务API在身份中间件中增加明确的Bearer分支：Authorization仅允许一个严格格式Bearer；无效Bearer不可回落cookie，混合cookie/Bearer身份拒绝。Bearer凭证不从query/body/cookie读取。cookie分支保留既有登录、SameSite及所有写操作精确Origin检查。Bearer CLI通常无Origin；若请求带Origin仍要求匹配，不能借Bearer取消网页CSRF约束。新cookie-only端点拒绝Bearer。网站login/logout/session不接受CLI Bearer。错误只返回安全错误码/中文摘要，不返回token/hash/SQL/输入正文；Authorization与请求/响应body不进入日志。

首版scope为 `data:read`（全部业务GET）、`data:write`（创建/更新/上传/normalize/unconfirm/快照create/retry）、`data:confirm`（仅confirm）；CLI默认请求这三项，网页逐项展示，用户可拒绝整次申请，首版不做复杂局部授权UI。服务端逐路由检查scope；confirm还要求显式acknowledged与version。权限不超越现有单管理员，未来多用户不能把scope当资源所有权校验的替代。HTTP方法与map可共用权限注册元信息，测试查漏。

`auth status` 默认联系self验证实际状态；可提供 `--local` 只报告本地记录且明确“未在线验证”。`auth revoke` 撤销当前origin的grant后删除本地记录；401表示已失效可清理，网络失败不声称已撤销。可显式 `auth forget` 仅清除本地记录，告知远端仍可能有效。网页设置区列出客户端、权限、创建/到期/最近使用时间与撤销按钮。令牌30天到期、不提供refresh token，过期重新浏览器授权；平台管理员密码变化使credential hash不同，所有旧会话/CLI授权失效。

## 5. 数据迁移与生命周期

增加版本化 `003-cli-authorization.sql`，现有001/002及其校验值不变，不drop/reset，预备schema3及兼容声明。新增表不改原图/框/快照：

- `omr_cli_auth_requests`：随机request_id PK、client_name/device_description、user_identity（首版管理员username，批准时绑定）、credential_hash、redirect_uri、state、code_challenge、method限定S256、scopes、status（pending/approved/denied/consumed/expired）、code_hash UNIQUE可空、created_at/expires_at/code_expires_at、failed_exchanges；schema字段范围/长度/check约束。state/challenge不是Bearer，仍不写日志。
- `omr_cli_grants`：随机grant_id PK、token_hash UNIQUE、user_identity、credential_hash、client_name/device_description、scopes、created_at/expires_at、revoked_at、last_used_at。只存hash，无token明文。时间索引便于清理；token随机高熵用SHA256，和低熵密码的scrypt用途区分。

批准、拒绝、换码、撤销都采用参数化SQL，状态机更新带条件并使用事务。pending只能走批准/拒绝/过期，approved只可消费/过期；到期判断以数据库时间为准，重复approve/deny返回冲突，不能换发码。验证grant时查未撤销/未过期且credential hash匹配当前配置；last_used_at节流更新（如5分钟一次），避免每请求写放大。清理由应用限频批量执行过期请求和过期/撤销grant保留期（例如7天）后的记录；不把运行时清理混入禁止DELETE的expand SQL迁移，先标识过期再分批清理。

迁移前仍执行锁、备份、校验。新代码声明支持schema3，schema2旧release不宣称可回退到schema3；部署失败按兼容检查停止/回退，不降级数据库。新数据表不存图片或永久OSS URL。不以RDS超级用户运行。测试从真实schema2数据升级至3、重复执行以及旧数据/会话/快照保留。

## 6. Origin、HTTP与本地凭据

实际已知平台是 `http://116.62.12.100:8790`，**不是HTTPS**。默认拒绝非回环HTTP。仅严格回环hostname（localhost、127.0.0.1、[::1]）开发HTTP可用，不将私网IP/相似域名视为回环。远端HTTPS使用标准证书验证，不支持insecure TLS开关、不设置NODE_TLS_REJECT_UNAUTHORIZED=0。

兼容当前平台必须显式 `--allow-insecure-http`，auth前stderr说明密码网页登录、授权码与Bearer在HTTP网络上可能被监听/篡改，PKCE不提供传输加密；不静默降级。该选择随规范化origin独立保存，仅授权这一origin，换origin不继承。业务请求若由命令行覆盖origin且没有对应授权选择，应拒绝；不能因别处配置过HTTP就允许所有地址。回环callback本身使用HTTP，与远端平台HTTP风险分开描述。不改域名、证书、ECS端口/安全组。

origin使用URL解析，只接受http/https、无userinfo/query/hash，pathname为空或根路径；规范化协议/主机/默认端口，origin为隔离键。CLI本地目录建议 `$XDG_CONFIG_HOME/xianji-omr` 或 `~/.config/xianji-omr`（Windows按平台用户配置目录），每origin独立文件名为origin摘要，内容再记录origin防错配。目录0700、凭据文件0600，同目录随机临时文件以wx/0600创建、写入fsync后rename原子替换；拒绝符号链接/异常类型/不安全权限，已有文件在读取时检查，配置冲突不静默抢写。Windows文件模式不是完整ACL保证，文档明确限制并尽可能限制为当前用户，未验证前不承诺等同POSIX0700隔离。

文件包含origin、token、grantId、expiresAt、scope、allowInsecureHttp，不打印内容，不进入仓库。CLI不接受 `--token` 参数，不在URL和错误中嵌入凭证，不输出浏览器cookie。进程中凭据只经Authorization传输，不把token传给浏览器打开进程。并发auth对同origin用专用锁/安全独占创建，冲突明确失败，不覆盖另一个正在授权的结果。

回调URI校验：只允许 `http://127.0.0.1:显式有效端口/cli/callback`，无userinfo/query/hash、不接受localhost或其它IP作为callback、不允许路径编码/尾斜杠变体；服务端使用规范化后完全一致的字符串进行换码比对。拒绝自定义scheme、远程域名及端口缺失。CLI只接受服务端返回的同origin authorize URL，不能打开服务器返回的任意站点。

## 7. CLI输入、输出、下载与错误

业务成功stdout只输出一份JSON；进度、授权URL、HTTP风险提示和错误在stderr。错误采用稳定结构 `{error:{code,message,status?,details?}}`，details只允许经过脱敏的安全字段（如冲突资源ID）；禁止反射未经筛选的服务器正文/headers。约定退出码：0成功，2参数/本地输入错误，3认证失效/缺失，4权限不足，5版本/状态冲突，6网络/服务端失败，7本地文件/完整性失败，8用户拒绝/授权超时，130中断。可用机器码区分相同退出码原因。401不自动改用cookie或重新登录；409不重试写操作、不丢失输入文件或stdin已读内容，也不自动拉取新version覆盖。

JSON --input支持文件与`-`，有字节上限、JSON解析/必需字段校验；不读取服务器私密配置。输入框坐标保持原生整数像素，原样提交服务端确认，不把视图比例带入；CLI不做EXIF/sharp变换。上传读取真实文件并检查文件头/MIME/文件尺寸，流式传字节、服务端继续负责像素/方向校验，网络中断不伪称成功，不自动重试可能已提交的写请求。stdin图片可显式 `--file - --mime ... --name ...`，尺寸有界，不能把base64 JSON当图片上传。批量便利别名若实施应顺序明确报告每项结果，首版优先单项命令。

HTTP客户端 `redirect: manual`，任何重定向默认报错，不转发Bearer到其他origin，也不自动跟随同源到异源链。连接/响应超时和Ctrl-C使用AbortController，普通JSON响应有上限；错误只解析有限JSON。服务端给CLI返回数据不应包含私有OSS key/凭据；不接收签名URL让CLI直连OSS。

所有content/download写入同目录随机`.part`（wx/0600），流式计算SHA256，验证期望长度/校验值后发布最终文件；失败或中断清理本次part。默认拒绝已存在目的文件，包括符号链接；最终使用无覆盖的原子发布（同文件系统link+unlink等，不能仅exists后rename造成TOCTOU覆盖），不默认提供覆盖模式。stdout输出路径/字节数/checksum等元信息，二进制不混入JSON stdout。

快照以X-Checksum-Sha256和已获取的snapshot artifact元信息交叉检查；必须有有效64hex哈希，否则拒绝完成。v2图片content可由pages get的coordinate working/original checksum核验；legacy用get.image.checksum核验。下载前后版本/元信息匹配；服务端可统一补充图片checksum/length响应头（保持现有内容语义）减少不一致窗口，但不能依赖未经哈希验证的文件。旧快照即使不在最近30条列表中也必须能下载；快照下载直接使用该下载响应的 X-Checksum-Sha256 与 Content-Length 校验，有列表元信息时可交叉检查，但不得强制列表命中。服务端在查到精确快照记录并取得对应对象流后才设置这些响应头；下载成功与否不取决于列表窗口。HTTP模式哈希只能发现损坏，不能抵御主动攻击者同时篡改哈希。artifact链接/文件名不能改变目标origin或由服务端控制本地路径。

快照create返回accepted；如提供wait选项，只轮询已有dataset snapshots list，明确列表上限及找不到状态的错误，不虚构snapshot GET接口。默认返回ID，由用户显式下载ready快照。没有训练器、上传权重、模型注册命令。

## 8. 当前 HTTP 平台与授权定位

可使用当前 `http://116.62.12.100:8790`，但必须由用户显式 `--allow-insecure-http`，stderr提示明文风险，授权选择按origin隔离保存。缺少证书不阻塞本轮开发，不申请域名/证书、不调整ECS网络。默认远端HTTPS规则和回环开发HTTP规则按第6节执行。

这是平台专用的浏览器授权协议，借用一次性码、PKCE S256及state保护，不宣称HTTP公网部署满足标准OAuth的TLS要求，也不宣称实现完整标准OAuth服务。PKCE不能替代HTTPS；网页登录、授权码和Bearer可能被网络攻击者读取/篡改。必须保留现有网页登录及用户明确点击授权，不能以便利为由使用密码CLI登录、Cookie提取、静默授权或长期共享密钥。

## 9. 部署兼容与离线分发

现有根包及锁文件结构保持，deploy/deploy.sh 原归档 `package.json package-lock.json web server deploy` 继续作为生产服务发布边界。CLI不作为生产服务启动依赖，无须将tools/cli放进ECS服务release。新增授权后端和授权网页分别在server/web中，随既有归档发布；不能让API运行时反向导入tools/cli模块，命令map在CLI侧，由测试比对实际API路由。

现有 npm ci/build/start 命令与原生ESM服务入口保持。新增003迁移、schema3声明与备份兼容规则见第5节。保留AF_NETLINK、systemd单元命名、独立服务端口和路径，不改弦记8787。用隔离归档检出验证相同安装/构建/启动过程；不是生产部署。后续ECS升级仍是现有仓库 `git pull --ff-only` 后 `sudo bash deploy/deploy.sh`，本轮不执行。

## 10. 验收标准

以下是待实施的验收门槛，本文档提交不代表任何新测试已运行或通过：

1. 24项业务模板双向覆盖；注入未映射业务路由时测试失败。排除项精确且有理由，独立测试授权接口。所有规范命令真实调用隔离API，包括snapshot两kind和旧images路径，无删除/分页假接口。
2. 真实隔离PostgreSQL18、mock OSS、专用测试账号，覆盖schema2带数据升级schema3与幂等、原图/框/版本/会话/快照保留、授权允许/拒绝/过期/replay/wrong PKCE/state/Host/路径/redirect、并发交换、token撤销/过期/credential变化/scope、Origin规则、大小与限流。
3. 真实CLI入口及离线包入口覆盖参数/file/stdin、原图字节上传、标注保存与并发版本冲突、显式确认、normalize legacy、快照冻结/重试/导出；不自动确认、不覆盖冲突，冻结后编辑不改变导出。旧快照不在30条列表仍能经精确下载头校验完成。
4. 目录0700/文件0600、符号链接/权限/同origin并发、原子写失败、不同origin隔离、状态在线验证、撤销网络失败不假报、超时/Ctrl-C清理listener。stdout只有业务JSON，stderr进度/安全错误，无秘密出现在日志/参数/URL（一次性回调code例外）。
5. 流式上传/下载：验证哈希/长度、无哈希失败、断流/损坏/重定向、已存在目标/符号链接/竞争、不覆盖与part清理；大对象RSS观测有界，不整包Buffer。HTTP默认拒绝、显式origin允许与保存、TLS错误拒绝、跨origin不泄漏Bearer。
6. 实际离线tar.gz解压到repo外，独立工作目录，无repo node_modules/private config、无自定义npm安装，运行完整CLI真实API集成套件；测试不靠CLI导入server fixture。测试宿主可运行服务端fixture，子进程CLI只接收平台origin及临时用户配置目录。Node内置模块导入审计、文件白名单/秘密扫描、可执行入口和版本检查通过。
7. 原有测试、网页构建、原标注工作台回归、部署脚本语法、从git archive生成release后执行原npm ci/build/start与schema健康检查。测试迁移失败/兼容回退、保留AF_NETLINK；所有数据库只用隔离fixture，生产配置不参与。
8. 云端浏览器在隔离平台实际审批/拒绝/撤销，配合CLI回调验证；无人值守测试仅临时账号，不代替真实用户自动授权。浏览器策略/原生浏览器打开器若无法在云端实测，明确列限制，不把HTTP测试当浏览器实测。真实生产联调、跨操作系统实机、npm发布不在通过声明中。

先文档复核，收到实施通知后按计划实现。提交前fetch最新main，安全整合更新并重跑受影响检查；不force、不reset覆盖修改。最终准确交付源码、离线包、SHA、验证证据、限制及ECS升级注意事项。
