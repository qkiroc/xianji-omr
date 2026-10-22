# 切图标注 · xianji-omr

中文、独立原图矩形标注工具。上传PNG/JPG/WebP，拖拽画框、移动、四角缩放；视图平移/缩放不改变原图像素坐标。支持删除、撤销/重做、侧栏坐标修改、登录后的图片库与云端保存、JSON导出/导入（含原图）。不包含识别、训练或旧平台集成。

生产：Node22.18+同源网页/API，私有OSS存原图，PostgreSQL18存元信息/坐标/版本与会话；浏览器只保留本地草稿。请按 [ECS部署说明](deploy/README.md) 首次配置并运行 `sudo bash deploy/deploy.sh`。

## 云端隔离开发/验证

```bash
npm ci
npm run build
# PATH中需有PG18的pg_dump/pg_restore（测试会真实备份恢复）
npm test
python3 test/config-pty.py
bash -n deploy/deploy.sh deploy/bootstrap.sh
# 独立隔离PG+内存对象存储，切勿作为生产入口
npm run dev
```

开发预览默认4173，Origin为`http://terminal.local:4173`（云端QA）。如自行在开发机用回环地址启动，可修改test/preview.mjs的origin为实际地址。测试预览可访问`/__test-login`进入一次性模拟会话；此路由**仅存在于test fixture**，生产app及部署归档不包含test目录，生产只支持真实管理员登录。测试用户名/密码是固定虚构值，仅适用于隔离测试。

测试使用npm锁定的embedded-postgres PostgreSQL18.1二进制，端口55440（集成）、55439（预览），回环监听，随机临时目录/独立库，mock OSS不连接阿里云。Linux x64环境验证。非root正常运行；本Work云端仅映射UID0且禁止Unix socket，fixture在临时目录编译**仅测试使用**UID/stat兼容库，只注入隔离PG子进程，以TCP回环运行，不修改系统安全策略，也不进入生产包。需要gcc；不要将test fixture用于公网或生产。

JSON version=1，image含id/name/mime/width/height/checksum/dataUrl；boxes为{id,x,y,width,height}，左上原点，整数像素，宽高为长度（右边界x+width可等于原图宽）。导入为新的本地文档，保存生成新的服务端ID，不信任导入的serverId/version，也不覆盖已有图片。手动导出JSON默认嵌入原图，便于迁移；云端数据库不存base64/二进制。服务端只存object key，不保存签名URL。

快捷键：V选择、R画框、H平移、空格/中键拖动平移、滚轮围绕鼠标缩放、Delete删除、Ctrl/⌘Z撤销、Shift+Ctrl/⌘Z重做。拖拽结束形成一次撤销记录。视图调整不进入标注撤销历史；刷新/重新打开会重置内存撤销栈，保留图片/标注草稿。

生产源文件为web/index.html、server/与deploy/；构建将网页复制到server/static，API为原生ESM。没有外部CDN、前端密钥、GitHub自动部署或PR。
