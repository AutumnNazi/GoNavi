# 插件市场认证方向（2026-10）

插件体系上线仅数日，没有需要保留的客户端登录兼容面。市场认证统一为以下三条，不再保留设备码双轨：

## 职责边界

- **桌面客户端**：匿名只读。只调用 `/api/v1/plugins`、版本、artifact 下载与公开评分读取；提供安装、更新、权限确认。不提供登录、退出、设备授权轮询、发布、评分写入入口。
- **市场网站**：唯一账号与写入入口。GitHub OAuth + HttpOnly 会话 Cookie + `X-GoNavi-CSRF`；调用 `/api/v1/auth/web/*`、`/api/v1/publisher/*` 与评分写入。
- **运维/CLI**：不经过浏览器或设备码。操作员用 `gonavi-market-server -issue-session <github-id>` 显式签发 Bearer token（数据库 operator 凭据，仅打印一次）；`GET /api/v1/auth/session` 校验，`POST /api/v1/auth/logout` 吊销。

## 要删除

- 客户端：`PluginMarketLogin/PollLogin/Logout/Submit` 及 source 变体、前端 `login/pollLogin/logout/submit` 包装、`internal/pluginmarket` 的 `Login/PollLogin/Logout/Submit`、对应类型/测试/Wails 与 Web RPC 注册。
- 网站：旧设备码页面与 `verifyDeviceCode`、设备码类型。
- 服务端：`/api/v1/auth/device`、`/auth/device/token`、`/auth/device/decision`、`/auth/github` 设备登录入口、consent 页面、`DeviceGrant` 与设备仓储方法、相关测试。
- 文档：设备码/兼容旧客户端的说明。

## 要保留

- `/api/v1/auth/github/callback`：GitHub OAuth App 已注册的唯一回调，仅用于网站登录；`/api/v1/auth/web/*` 为网站会话。
- `market_sessions`：网站会话与运维 Bearer token 共用。
- `market_devices` 表与 `market_auth_flows.user_code`/`consent` 枚举：先停止读写，暂不做破坏性迁移；后续单独清理 schema。

## 理由

桌面端不再写账号，设备码没有合法使用者；保留只会让两套登录路径长期并存。网站是唯一发布入口，运维走显式 token，权限与审计边界更清楚。
