# 数据集卡片、原图数据表与元信息选区

状态：用户已确认，合并 OMR-META-20261022；仅GPT云端开发，不操作生产或用户本机，不使用子代理。

## 页面与导航

左侧常驻导航只有“切图标注”。右侧首页以数据集卡片显示名称、图片数、确认数、更新时间、新建及软删除。**以用户最后确认的歌曲维度为准，取代此前一行一张谱页的设计**：卡片进入歌曲表，每行一首歌，显示首页缩略图、歌曲名、谱页数、框数、已确认页数/总页数、更新时间。歌曲名称/分组/文件名/来源搜索、状态/split/歌曲/删除状态过滤；服务端分页25/50/100，created_at、id降序稳定排序，计数与结果在同一数据库快照。空歌曲可直接进入上传，不要求先有谱页。

点击歌曲进入完整窗口编辑器，隐藏全局顶部Header与平台导航；左侧仅显示这首歌的全部谱页，中央画布，右侧框与元信息属性。点击谱页或上一页/下一页在歌曲内部按页序切换，不受外部歌曲筛选限制。支持拖拽调整顺序，另提供上移/下移键盘可达操作；排序立即保存但不改区域/确认状态，完整id/version列表服务端原子校验，缺页、跨歌曲、过期版本均拒绝，禁止静默覆盖并发修改。已有未保存标注时要求先保存再排序。为已单独删除页保留页序槽位，恢复不碰撞。URL保存dataset/page/editorSongId及歌曲表筛选/页码，刷新恢复当前页及排序，返回歌曲列表保留筛选/页码并恢复全局导航。空歌曲URL也能直接打开。

左侧谱页支持独立软删除、已删除筛选与恢复；歌曲表支持单首/批量软删除及恢复，行内操作不误入编辑。上传指定所属歌曲；编辑器内上传固定为当前歌曲。编辑器不提供“页面来源、曲目与页序”弹窗或按钮；歌曲信息在列表管理，页序仅由左侧拖拽/上移下移调整。来源、曲目、split在同一数据集内部管理，不按来源、状态或导出批次拆数据集。草稿保护、版本冲突与选中框隐藏其他框保留。

## 软删除与隔离

schema4增量新增datasets.deleted_at/songs.deleted_at/images.deleted_at/images.source/annotation_version、分页索引，旧SQL不改。数据集delete/restore均需version；父级删除不改图片独立deleted_at，恢复父级不复活原来单独删除的歌曲或图片。歌曲删除不改图片独立deleted_at，恢复歌曲也不复活原来单独删除的图片。歌曲级批处理同时验证song.version与所有子页id/version的page_revision摘要，防止删除未审阅的新增或改动页。父级删除/恢复会递增相关图片version，阻止跨删除周期的陈旧客户端写入。单张及批量删除/恢复必须每条id+version，事务全成或全败，最多100条，同dataset校验。父级不可用时禁止所有相关图片/曲目读取、写入、上传、确认、新快照；legacy接口也统一检查，不能绕过。

采用数据集事务advisory lock后锁图片的统一顺序，保存、删除、恢复和冻结读视图不互相绕过。数据集删除前获取全量影响计数并弹确认；删除不删OSS对象、不删历史快照。冻结来源及ready包保持不变，已冻结包仍可认证下载；为避免旧冻结重试可读历史对象，exporter只消费冻结内容，不回查活跃页面。删除父级后不允许新建快照，旧快照列表/下载仍可查看。不提供永久删除。

新增歌曲API：GET datasets/:id/song-records（分页聚合），POST datasets/:id/songs/delete|restore（items含id/version/pageRevision），POST songs/:id/pages/reorder（完整items含id/version）；GET songs/:id/pages支持deleted筛选，旧数组返回格式保留。CLI songs catalogue/delete/restore、pages reorder同步。

新增CLI/API：GET dataset pages分页、GET page neighbors、POST dataset delete/restore、POST dataset pages delete/restore（id/version数组）；沿用现有GET datasets支持deleted筛选。路由机器映射同步扩展，旧命令保持。

## 类别与元信息契约

layout-v1前7类及YOLO0–6/COCO1–7完全固定。layout-v2只追加六类：7 title（标题）、8 performer（歌手/演唱者）、9 time_signature（拍号）、10 key_signature（调号）、11 tempo（速度/BPM）、12 capo（变调夹）；COCO为8–13。旧页/快照保持v1，不猜测chord_marks含义；新编辑保存显式layout-v2，旧v1请求不得覆盖已经v2的页。旧模型不具备新类别能力。taxonomy API默认返回v2，支持显式v1。

每个字段画完整区域，不逐字。新增框可带metadata={rawText?,scope:'page'|'global'|'local',value?:...}，原文和值均可缺省，空对象也能保存。title/performer只属于当前曲目/谱本的实际页；不复制框到其它页。title支持多行。performer.value.role固定performer，词曲作者/编配者/制谱人不能混作performer，不自动识别身份。拍号value={numerator,denominator}；调号value={kind:'original'|'written'|'play',tonic}，保留原文如1=E♭、Play=C；tempo value={bpm?,beatUnit?,dotted?}，beatUnit采用1/2/4/8/16/32/64，dotted布尔，速度词只有rawText合法；capo.value={fret:0..24}，缺省不等于0，不从调号推断。字段范围服务端校验，无隐式补值。metadata未知字段拒绝，避免静默剥离；legacy/v1携带新内容拒绝升级提示。

元信息页级/global无需system，local可选关联本页system，关联则检查包含；title/performer/capo仅page/global，拍号/调号/tempo支持local及多次变化。原有七类父子规则不变。所有坐标均工作图原生整数；原图/EXIF映射不变。

## 导出与兼容

冻结manifest记录taxonomyVersion及每来源annotationFormat。纯v1快照保持旧7类，包含v2页则导出layout-v2 13类；已有冻结manifest/包不重写。原生、COCO扩展字段、裁片来源映射完整保留metadata；YOLO仅区域定位，伴随native/manifest保存元信息，不宣称文字真值自动生成。规范化去重比较必须包含metadata/范围/结构化值，不能把相同几何不同内容静默去重。CLI JSON透明往返，备份/导入保留元信息、类别格式，旧草稿不自动猜分类。

## 验收

隔离PG18/mock OSS执行schema3带数据升4、旧会话/grant/快照保留；软删除/恢复/并发version/跨dataset/legacy绕过/父级不可用；分页稳定排序、筛选计数及数千页。六类空框与内容保存读回、Capo0/缺省、BPM拍单位/附点、页/global/local、多页归属；v1/v2保护与冻结包独立校验。实际浏览器卡片/表格/上传/筛选/编辑/返回/刷新/草稿/软删除恢复及metadata字段。回归CLI、原有测试与部署归档，不声明生产实测。

## 原图 / 裁片检查闭环（追加并已实施）

沿用最后确认的歌曲表，不回退成单图表。歌曲行“查看裁片”打开该歌曲首页的结果视图，编辑器左侧可切换任意谱页；单页裁片不跨歌曲/数据集管理。原图编辑和裁片结果只共用一份doc/boxes/dirty及撤销栈，切换不保存、不确认、不创建图片或训练样本。cropResults按稳定框ID回选原图并缩放定位，结果回来保留类别/复核筛选及每页滚动位置。宽区域一行一张、小区域网格；缩放预览不改整数边界，无padding，独立大图，原图总览始终画全部框提醒漏标。预览大小受限、可见卡片惰性绘制，全部框仍用于总览。源图错误清空预览并提供重新加载，不以旧结果伪装成功。

共享server/src/crop-rules.mjs（构建复制至网页），前端drawImage与导出sharp.extract均用cropRectangle校验的同一整数矩形，边界不扩大。浏览器预览可等比降采样，导出保持原生PNG尺寸；像素测试用非纯色图逐字节验证sharp结果，不宣称缩略图PNG字节与导出文件相同。

每个框可选reviewStatus=draft|needs_adjustment|confirmed，旧框缺省按原页确认状态解释。改几何、类别、元信息、父框或顺序后只撤回该框确认；未变框保留服务端状态。页级保存仍取消整页确认，逐框全部通过也不能代替整页人工查漏确认。PUT不能提升复核权限：服务端按旧框语义合并reviewStatus，不接受来路声明“confirmed”。新增POST /pages/:pageId/regions/:regionId/review，version乐观锁；confirmed须data:confirm+acknowledged，needs_adjustment/draft须data:write，原Origin/身份分离不变；标需调整不删除框。CLI regions review同步。

schema4同时新增images.deleted_boxes，仅保存已保存后被移除的框，保持ID/内容供恢复，不进入导出/训练计数；上限5000，超出拒绝保存而非截断历史。当前浏览器删除可撤销，保存后可在裁片结果“已删除区域”恢复；尚未保存的新框删除也保留于本地doc并可恢复或撤销。POST /pages/:pageId/regions/:regionId/restore需version/data:write，恢复为draft，不恢复旧确认。CLI regions restore同步。历史快照只消费已冻结boxes，保持不可变；旧客户端无reviewStatus不抹掉服务端复核记录。

最终交互修订：编辑器不提供页面来源/曲目/页序弹窗。原图编辑/裁片结果切换置于顶部居中，前后页在歌曲侧栏；裁片四个操作为单行图标，保留title悬停说明与aria-label。

列表顶部提供独立“冻结快照与导出”操作按钮，以弹窗承载创建快照、状态、重试与下载记录，不再放于表格底部折叠区。列表仍按歌曲，单页在歌曲编辑器内管理。
