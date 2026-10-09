# FoeFlow

FoeFlow 是面向公众号内容工作流的桌面辅助应用，包含文章审核、AI 写作与排版、文章库、Word 导出、邮箱待办和图片压缩。项目使用 React、TypeScript、Vite、Tauri 与 SQLite。

仓库包含前端、Rust 后端、许可证服务和测试，桌面配置版本为 **0.1.0**。公开版本不包含个人凭据与运行数据。

## 本地开发

需要 Node.js / npm；桌面开发另外需要 Rust 和所在平台的 Tauri 开发环境。

```bash
npm ci
npm run dev          # 前端开发服务器
npm run build        # TypeScript 检查 + 前端生产构建
npm test -- --run    # 单元测试
npm run lint
npm run tauri:dev    # 桌面开发
```

浏览器模式用于前端开发；数据库、邮箱、文件操作和激活等功能依赖 Tauri 桌面后端。AI 服务需在设置页配置可用的 API 地址、模型和密钥；默认校内 API 需要相应访问权限。

```bash
cd src-tauri
cargo check --locked
```

原始打包配置面向 Windows NSIS。在 Windows 配置好开发环境后，于仓库根目录执行 `npm run tauri -- build`。

## 许可证服务

桌面后端默认连接本地 `http://127.0.0.1:3000`。可在编译前通过 `LICENSE_SERVER_URL` 环境变量指定自有服务；如果服务地址变化，同时核对 `src-tauri/tauri.conf.json` 的 CSP。

```bash
cd license-server
npm ci
cp .env.example .env
# 为 LICENSE_SEED 和 JWT_SECRET 分别填写独立随机值。
npm start
```

服务使用独立 SQLite 数据库。`.env.example` 不含实际密钥；测试中的凭据仅供本地测试使用。管理员账户和许可证数据需自行初始化，未包含任何生产数据库、账户密码或已发放激活码。

运行服务测试时使用内存数据库，避免影响本地数据：

```bash
DB_PATH=:memory: npm test
```

## 当前验证状态

前端构建与 Rust 检查通过；217 项前端测试和 7 项许可证服务测试通过。代码检查仍有 47 个错误和 11 个警告。Windows 重打包、完整桌面交互及真实 AI、邮箱、生产激活服务尚未验收。

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/` | 前端页面、组件、业务逻辑 |
| `src-tauri/` | Rust 桌面后端与打包配置 |
| `tests/` | 单元测试、桌面接口模拟与 E2E 用例 |
| `license-server/` | 激活、验证和管理员接口 |
| `public/` | 图标和通用占位素材 |

公开版本以通用演示文章替换原校园范文，以说明占位图替换个人收款二维码。真实 API 密钥与邮箱授权码需自行配置，不应写入源码。

项目主页：[vviii.asia](https://vviii.asia) · 作者：[Violet](https://github.com/Seeleangel)
