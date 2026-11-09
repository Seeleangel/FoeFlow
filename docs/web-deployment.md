# FoeFlow 网页版部署

```sh
npm ci
npm run build:web
npm run preview:web -- --host 127.0.0.1
```

浏览终端给出的地址加上 `/foeflow/`。网页产物位于 `dist-web/`，与桌面构建的 `dist/` 分开。网页版不连接许可证服务，也无需在服务器运行 Node.js 或保存稿件数据库。

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
