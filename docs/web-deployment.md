# FoeFlow 网页版部署

```sh
npm ci
npm run build:web
npm run preview:web -- --host 127.0.0.1
```

浏览终端给出的地址加上 `/foeflow/`。网页产物位于 `dist-web/`，与桌面构建的 `dist/` 分开。网页版不连接许可证服务，稿件无需服务器数据库。网页静态托管与 Node.js 账号服务配合；文稿仍在浏览器保存。

## HTTPS 托管

1. 将 `dist-web/` 的内容放入新的静态发布目录下的 `foeflow/` 文件夹，将 `/var/www/foeflow-web-current` 指向该发布目录。
2. 在现有 HTTPS server 中包含 [静态与代理路由](../deploy/foeflow-web.nginx.conf)，把 [模型代理片段](../deploy/foeflow-model-proxy.nginx.conf) 安装到其指定位置。确认服务器将 `.wasm` 作为 `application/wasm` 提供。
3. 运行 `nginx -t` 后重载。旧发布目录及旧配置留作回退。现有 `/api/v1/` 和 `/admin` 仍由桌面许可证服务负责。

网页以 SQLite WASM 和 IndexedDB 保存本机数据。部署的内容安全策略允许本地脚本编译 WASM。模型地址固定为校内接口时，网页只将聊天和图片生成请求转发给 `chat.ecnu.edu.cn`，带调用者填写的 Bearer 密钥，不注入服务器密钥，不记录转发请求。其他模型从浏览器直接连接，须使用 HTTPS 并允许站点来源的 CORS 请求。模型凭据与草稿留在浏览器，清除该站点数据会移除它们。

## 验证

```sh
npm test -- --run
npm run build
npm run build:web
python3 tests/web/smoke.py
```

浏览器验收脚本需安装 Python Playwright 与 Chromium。它覆盖启动、模板排版、Word 导出、刷新后的草稿读取、图片压缩、模型配置、文字审核与写作对话。模型回复用测试数据模拟；不会发送真实密钥、正文或消耗模型额度。可通过 `FOEFLOW_WEB_URL` 指向实际部署地址复验。

## 邮件箱

安装 Node.js 24，运行 `npm ci --prefix mail-server --omit=dev --ignore-scripts`。将 `mail-server/` 发布到独立服务目录，使用 [systemd 模板](../deploy/foeflow-mail.service) 和 [Nginx 路由模板](../deploy/foeflow-mail.nginx.conf)。后端仅监听回环地址，需能通过 TLS 访问 `imap.163.com:993`。使用独立服务用户与私有状态目录。

服务配置 `/etc/foeflow-mail/server.env` 包含 `FOEFLOW_MAIL_DB`（私有 SQLite 路径）、`FOEFLOW_MAIL_ORIGIN`（实际 HTTPS 来源，不带路径）和 `FOEFLOW_MAIL_PORT`（检测出的空闲端口）。生成独立的 32 字节十六进制密钥，保存为 root 私有的 `/etc/foeflow-mail/key`，由 systemd 传入。密钥不能在重部署时重新生成；私有备份数据库及密钥，分别限制访问。邮件授权以 AES-256-GCM 加密保存，登录密码仅保存 scrypt 派生值。服务器不持久保存邮件头、正文或附件。打开正文使用 IMAP BODY.PEEK，取得正文后才为当前邮件添加已读标记；同步列表和下载附件不会写入邮件状态。正文中的活动内容、样式和远程图片不会加载。附件以下载方式返回，单个文件限制为 20 MB。

网页入口统一登录，用户名和密码自助注册，不使用邀请码。原邮件账号与邮箱配置可继续使用。网页登录会话保护邮件接口及固定校内模型转发，代理需启用 Nginx 的 `auth_request`。邮件按 30 封分页读取收件箱，已读样式以 163 的实际状态为准。

工作区按账号隔离浏览器数据。旧版未绑定账号的资料不自动分配；在设置中可主动导入到一个空工作区，原快照保留，模型密钥需重新填写。

本地 Web 开发使用 `FOEFLOW_MAIL_DEV_TARGET` 指向本地后端地址，`FOEFLOW_MAIL_ORIGIN` 需匹配浏览器实际来源。运行 `npm test --prefix mail-server` 验证注册、会话、账户隔离、授权加密、邮件与附件权限，以及 IMAP 的只读查询与单封已读操作；浏览器验收用 `tests/web/mail-fixture.mjs` 和 `tests/web/mail.py`，不使用真实授权码。
