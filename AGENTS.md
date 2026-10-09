# FoeFlow 开发指南

这是从备份恢复的应用源码。应用就在仓库根目录，旧 `.worktrees/foe-app` 路径不再使用。

## 结构

- `src/`：React + TypeScript 前端、业务逻辑及部分单元测试。
- `src-tauri/`：Rust / Tauri 桌面后端，包含 HTTP、IMAP、图片压缩和许可证命令。
- `tests/`：Vitest 测试、Tauri mocks 和 Playwright E2E 用例。
- `license-server/`：独立 Node.js 许可证服务。
- `public/`：公开静态资源；收款二维码已替换为占位图。

## 开发

在仓库根目录执行 `npm ci`、`npm run build`、`npm test -- --run`、`npm run lint` 和 `npm run tauri:dev`。
路径别名 `@/` 指向 `src/`。桌面功能需要 Tauri 环境，浏览器模式不能替代桌面验收。

沿用 `CLAUDE.md` 中的产品背景与设计原则。新增功能和缺陷修复先补相关测试；恢复文件和文档编辑无需创建重复测试。保持小范围改动及类型安全。
不要修改依赖目录或构建输出，不要随意更改 Tauri 的 `identifier`、`productName`。

## 数据与配置

应用数据通过 SQLite 持久化，迁移位于 `src/hooks/useDb.ts`。API 密钥、邮箱授权码由用户在设置页配置。许可证服务需要独立配置 `LICENSE_SEED`、`JWT_SECRET`，详见 README。

不要提交 `.env`、数据库、用户令牌、私人素材、收款码、备份凭据或旧备份 Git 历史。公开版演示文章不包含原校园范文。

恢复记录和当前验证状态见 `SOURCE_RECOVERY.md`。
