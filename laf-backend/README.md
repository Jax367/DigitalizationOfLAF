# LAF 服务端 0.7

完整启动、管理员初始化、客户端使用、缓存说明和扩展规划见 [根目录 README](../README.md)。本服务保持现有 Cloudflare Workers + TypeScript + D1 架构，图片新增独立 R2 binding `IMAGES`。本地通过 Wrangler 模拟 D1/R2，无需云端账号。

新数据库与升级数据库均执行 `npm run db:migrate:local`。`src/database/schema.sql` 仅是第一版结构参考，应以全部 migration 为准。旧账号迁移为 pending；原先接受任意角色和密码哈希的用户创建接口已移除。

## API

| 方法 | 路径 | 权限 / 功能 |
|---|---|---|
| GET | `/` | 公开健康检查 |
| GET | `/api/items`、`/api/items/:id` | 编辑会话或批准设备：设备只读未认领记录 |
| POST | `/api/items` | 已批准且有编辑权限的编辑者或管理员：创建 |
| PUT / DELETE | `/api/items/:id` | 已批准编辑者或管理员：修改 / 删除 |
| GET | `/api/images/:uuid` | 编辑会话或批准设备：设备仅读关联未认领记录的图片 |
| POST | `/api/images` | 已批准编辑者或管理员：原始二进制上传，最多 5 MB |
| DELETE | `/api/images/:uuid` | 有编辑权限的上传者或管理员删除未引用图片 |
| POST | `/api/auth/register` | `{username,password}`，固定为 editor / pending |
| POST | `/api/auth/login` | `{username,password}`，返回 token、user、expiresAt |
| GET | `/api/auth/me` | 当前已批准用户 |
| POST | `/api/auth/logout` | 注销当前 Cookie / Bearer 会话 |
| POST | `/api/auth/password` | `{oldPassword,password}`，修改后注销该用户全部会话 |
| POST | `/api/auth/bootstrap` | 首次管理员初始化，需要 `X-Bootstrap-Key` 匹配环境密钥 |
| GET | `/api/users` | 管理员用户列表，不含密码哈希 |
| PATCH | `/api/users/:id` | 管理员审批/编辑权限：`{approval_status:approved/rejected/disabled}` 或 `{can_edit:false/true}` |
| GET | `/api/logs` | 管理员审计日志 |

网页认证使用会话 Cookie；其他调用可携带 `Authorization: Bearer <token>`。JSON 接口要求 `Content-Type: application/json`，未知字段会拒绝。新失物必填 title 和 status，允许 description、floor 和 image_id。物品仅含 id、title、description、floor、created_at、status、image_id 七字段，录入时间由数据库管理。状态 found / claimed 表示待认领 / 已找回。image_id 为已上传图片 UUID 或 null，不能指定任意外部地址或创建者。

响应成功统一 `{success:true,data:...}`；失败 `{success:false,error:...}`。图片 GET 返回图片字节。常见状态为 400 参数错误、401 未登录/会话无效、403 权限或审批不足、404 不存在、409 冲突、413 图片过大、415 内容类型无效、429 限流。

## 测试与部署

`npm run typecheck` 检查严格类型；`npm test` 运行 scripts/integration.mjs，需要根 README 中的独立 8790 测试服务。测试拒绝访问非本机地址。不要用测试固定密钥初始化实际服务。旧 smoke.mjs 入口转发到新版测试。

本地 D1/R2 保存在 `.wrangler/state/`。管理员初始化密钥保存在被 gitignore 的 `.dev.vars`。正式部署使用 `wrangler.production.example.json` 复制得到的 `wrangler.production.json`，不要直接用开发 wrangler.toml。默认适配 Workers Free，省略自定义 CPU limits，保留 HTTPS、权限和限流，采用小批量清理；步骤和云端验收见 [DEPLOYMENT.md](DEPLOYMENT.md)。没有执行线上部署。

参考：[R2 Workers API](https://developers.cloudflare.com/r2/get-started/workers-api/) · [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)。

只读端使用 `GET /api/items?status=found`，只返回未认领完整记录。`GET /api/items/cache-status?ids=1,2` 最多接收 100 个序号，仅返回状态/认领时间或删除标记，用于本地一周清理。第三次迁移保留旧字段快照，并通过独立 item_claims 表记录认领时间。

## 0.5 网页与编辑权限

/editor/ 为同源网页工作台，由 public/editor 静态资源提供。认证支持 HttpOnly、SameSite=Strict Cookie，HTTPS 使用 Secure；携带 Cookie 的写操作检查 Origin。Bearer API 仍兼容。迁移 0004 为 users 增加 can_edit（默认 1）。PATCH /api/users/:id 支持 can_edit 布尔值，以及原 approval_status，可单独撤销/恢复编辑权限；所有状态或权限变更注销该账号旧会话。requireEditor 统一保护记录与图片写入。

GET /api/logs 管理员专用，支持 user_id、action、from、to（UTC 日期）、before 游标及 limit（1–100，默认 50）。日志包括操作人 username、时间、类型、目标、JSON 详情，修改记录保存 before/after；不含密码和令牌。用户/权限变更也记录前后状态。设备同步不逐次记录；匿名数据读取已在 0.6 禁止。新增 scripts/web-smoke.mjs 验证 Cookie、防跨站写入、撤权拦截、日志前后内容和管理员限制。

## 0.6 设备授权 API

| 方法 | 路径 | 权限与内容 |
|---|---|---|
| GET/POST | /api/access-groups | 管理员查询/创建组，POST {name} |
| PATCH | /api/access-groups/:id | 管理员启停 {enabled:boolean} |
| GET/POST | /api/reader-accounts | 管理员查询/创建，POST {username,password,group_id} |
| PATCH | /api/reader-accounts/:id | 管理员启停或重设申请密码 {enabled?,password?} |
| POST | /api/device/apply | {username,password,display_name,device_id,device_token}，正确账号密码提交待审批申请 |
| GET | /api/device/status | X-Device-Token 获取本设备状态，包括账号/组启用状态 |
| GET | /api/devices | 管理员列表，不返回凭证哈希 |
| PATCH | /api/devices/:uuid | 管理员 {status:approved/rejected/revoked} |

reader_accounts 与 users 分表；设备请求用 X-Device-Token，不赋予编辑写入或管理权限。访问组仅控制设备准入，物品库共享。设备凭证为 32 字节随机值的 64 位十六进制表示，服务端仅保存哈希；申请接口对来源和账号限流，所有创建、启停、设备申请和审批记日志，不记录密码或原始凭证。新设备必须等待批准，重复申请重新进入 pending。

## 0.7 安全限制与部署

正式 HTTPS、依赖版本、上传配额、分层限流、请求大小、分页协议及日志留存配置详见 [DEPLOYMENT.md](DEPLOYMENT.md)。域名未确定时部署检查会拒绝上线。本地运行始终使用开发配置，实际数据库升级由根目录启动脚本执行，本次测试未修改实际记录或账号。

无需购买域名时使用 `wrangler.workers-dev.example.json` 模板，正式入口为 `https://laf-production.账号子域名.workers.dev`。部署检查已支持此模式，仍只允许一个指定 HTTPS 主机名，保留设备审批和认证，关闭预览地址；填写真实账号及资源后使用同一 deploy 脚本。步骤见 DEPLOYMENT.md 的「不购买域名」章节。
