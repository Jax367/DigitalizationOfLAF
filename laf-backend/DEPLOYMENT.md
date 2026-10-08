# 正式 HTTPS 部署与安全限制（0.7）

目标平台为 Cloudflare Workers。可使用自有域名或指定的免费 workers.dev 地址；正式入口未确定时只做配置与本地验证，不上线、不创建云端资源。业务安全策略位于 src/services/security.ts，容量与配额位于 src/services/quota.ts，分页位于 src/utils/pagination.ts；将来迁移自有服务器可替换 Env 的数据库、图片和 RateLimit 接口适配器，保留这些规则。

## 依赖

当前锁定 Wrangler 4.148.0 → Miniflare 5.20261006.0-alpha → sharp 0.35.5。Miniflare 原始依赖指向 sharp 0.35.4，因此通过 package.json override 固定修复版；保留 undici override。2026-10-07 重新安装、完整 npm audit 报告为零项。不要使用 audit fix --force 自动降级到旧 Wrangler。

## 默认限制

| 项目 | 默认值 | 配置位置 |
|---|---|---|
| JSON 请求 | 32 KiB，按实际读取字节检查，无 Content-Length 也检查 | utils/http.ts |
| 单张图片 | 5 MiB，PNG/JPEG/WebP | routes/images.ts |
| 列表分页 | 默认 50，最大 100；before 游标与 snapshot 最大序号 | utils/pagination.ts |
| 总物品数 | 10000 | MAX_RECORDS |
| 全站图片容量 / 数量 | 5120 MiB / 5000 张 | UPLOAD_GLOBAL_MB / UPLOAD_GLOBAL_COUNT |
| 每个编辑账号图片容量 / 数量 | 500 MiB / 500 张 | UPLOAD_USER_MB / UPLOAD_USER_COUNT |
| 每个账号每日上传预算 | 100 MiB / 100 张，按 UTC 日期 | UPLOAD_DAILY_MB / UPLOAD_DAILY_COUNT |
| 来源请求 | 每来源 1200 次/分钟，包含网页入口 | ENTRY_LIMITER |
| 凭证读取 | 每凭证 300 次/分钟 | READ_LIMITER |
| 写请求 | 每凭证或匿名来源 60 次/分钟 | WRITE_LIMITER |
| 登录等认证请求 | 每来源 30 次/分钟，另保留账号密码尝试限制 | AUTH_LIMITER |
| 图片上传请求 | 每凭证 10 次/分钟 | UPLOAD_LIMITER |

图片配额覆盖已有文件、正在上传的预留和待删除文件，通过 D1 单条条件 INSERT 原子预留，防止并发超额。删除图片会释放存储容量，但不返还当天预算；有效上传获受理后的存储失败也不返还日预算，避免循环失败绕过限制。删除失败保留队列并继续计入容量。定时任务每小时处理过期上传预留、待删除文件、过期限流计数与旧日预算；每轮最多处理 10 个预留和 10 个删除任务。

正式示例配置开启 90 天日志留存，每小时最多清理 5000 条到期日志。LOG_RETENTION_DAYS 改成其他天数可调整，设 0 可关闭自动日志清理。生产使用前确认留存周期并安排日志导出。开发配置未设置此项，不自动清理操作日志。

Cloudflare RateLimit 为每个边缘位置的频率控制，并非全球精确计数；上传日预算和存储配额通过 D1 全局控制。Worker 被调用本身仍可能产生费用，应在 Cloudflare 设置 WAF/入口规则、监控和费用告警；应用限流不能承诺账单绝对上限。

## 正式入口

1. 在 Cloudflare 管理自己的域名，创建正式 D1 数据库和私有 R2 桶。正式与开发资源分开。
2. 复制 wrangler.production.example.json 为 wrangler.production.json。填写 account_id、真实 database_id、数据库名称、桶名；将 routes.pattern 和 vars.ALLOWED_HOSTS 改为同一真实域名。
3. 示例默认适配 Workers Free：vars.WORKERS_PLAN 为 free，省略整个 limits 配置，平台执行每次 HTTP/Cron 调用 10ms CPU 限制。关闭 workers_dev、preview_urls 与自定义域名的 previews_enabled。旧配置需要移除 limits.cpu_ms=50；部署检查会拒绝免费配置中的 limits。WORKERS_PLAN 是本项目的检查标记，不会读取或改变 Cloudflare 账号订阅。确实使用付费套餐时可显式改为 paid 并设置 1–100ms CPU 上限。
4. 可选 ALLOWED_SOURCE_IPS 为逗号分隔的准确来源 IP。空值允许各来源访问登录页，但所有记录、图片仍要求编辑会话或已批准设备。网络段/CIDR、管理员单独入口等限制应在 Cloudflare WAF/Access 中配置；不要把可由客户端伪造的请求头直接当身份。
5. 通过 Cloudflare secret 保存 ADMIN_BOOTSTRAP_KEY，不放进配置、前端或日志。首次初始化需与维护者初始化脚本使用的密钥一致；管理员建立后可移除该 secret。
6. 在 laf-backend 运行 npm run deploy:check；填写完整且安全检查通过后运行 npm run deploy。部署脚本先本地 dry-run，再执行正式远程迁移和部署。它不会自动创建域名、数据库、桶或 secret。
7. 访问 https://你的域名/editor/，客户端服务器地址填写同一 HTTPS origin。重新部署不会自动搬运本地 D1/R2 数据，已有数据迁移需另做导出和导入。

正式模式强制指定域名和 HTTPS，对其他入口拒绝访问，HTTPS 响应启用 HSTS；限流 binding 缺失时停止服务而不是静默放行。HTTP 写请求不自动重定向，以免重新发送密码。

## 免费套餐配置和首次上线

不需要点击 Workers 控制台的「升级」，也不需要手工创建模板应用。默认正式示例已经适配免费套餐。R2 仍需要开通订阅并完成付款资料流程；免费额度并非账单硬上限。域名购买不属于 Workers 免费额度。无需购买域名的流程见下一节，只允许指定的 workers.dev HTTPS 地址，保留认证和设备审批，不开放开发端口。

## 不购买域名：使用 workers.dev

在 Workers & Pages 页面找到「Your subdomain / 你的子域名」，登记或查看账号的 workers.dev 子域名。例如账号子域名为 school-laf，Worker 名称为 laf-production，正式地址就是 `https://laf-production.school-laf.workers.dev`。不需要添加网站、修改 DNS 或购买域名。

使用下面的模板替代自定义域名模板（如已有正式文件先备份，不要直接覆盖）：

```powershell
Copy-Item .\wrangler.workers-dev.example.json .\wrangler.production.json
notepad .\wrangler.production.json
```

填入真实 account_id，将 ALLOWED_HOSTS 中 CHANGE_ME 替换为真实账号子域名。保留 name=laf-production、workers_dev=true、preview_urls=false、routes=[]、WORKERS_PLAN=free；不添加 limits。其他步骤与本文件免费流程相同：在同一个 PowerShell 设置工具 PATH 和 XDG_CONFIG_HOME，npm ci、wrangler login/whoami、开通 R2、创建 D1/R2、填 D1 ID、deploy:check/deploy、设置初始化 secret、初始化管理员并删 secret、审批客户端。命令中的服务器地址使用上述 workers.dev HTTPS origin，网页编辑地址在后面加 /editor/。

部署脚本接受且仅接受一个与 Worker 名称一致的 workers.dev 完整主机名；不会根据请求动态信任其他主机名。预览地址仍关闭，匿名不能读取记录和图片。若部署输出地址与 ALLOWED_HOSTS 不一致，核对账号子域名、更新正式文件并重新部署。原自定义域名模板与检查仍然保留。

workers.dev 的大陆网络可达性必须在实际使用网络测试；Cloudflare 建议关键生产服务使用自有域名，但自有域名也不保证大陆网络可达性。免费 HTTP/Cron CPU 和存储操作额度的验收要求仍然适用。

免费示例设置 CLEANUP_IMAGE_BATCH=2、CLEANUP_ROW_BATCH=40：每小时最多处理 2 个过期上传预留、2 个待删除图片、40 个到期认证计数、40 个旧日预算和 200 条过期日志，剩余数据留给下一轮。不降低密码 PBKDF2 的 100000 次迭代；设备日常同步仍用令牌，不重复验证申请密码。配额包含排队删除的图片，因此清理积压期间可能暂时无法继续上传。批量参数不改变日志留存天数。未设置批量参数时保持每类图片 10 个、认证及旧预算 1000 条、日志 5000 条。

保持 Cloudflare 账号为 Workers Free，域名接入时选域名 Free 并等待 Active，开通 R2 后，在同一个 PowerShell 窗口执行：

```powershell
cd D:\develop\develop\LAF_seewo\laf-backend
$env:Path = "D:\develop\develop\LAF_seewo\.tools\bin;$env:Path"
$env:XDG_CONFIG_HOME = Join-Path (Get-Location).Path ".wrangler\config"
npm ci
npx wrangler login
npx wrangler whoami
Copy-Item .\wrangler.production.example.json .\wrangler.production.json
notepad .\wrangler.production.json
```

如果正式文件已存在不要覆盖。填 account_id、routes.pattern 和 vars.ALLOWED_HOSTS，域名字段不带 https:// 或路径。保留 WORKERS_PLAN=free，不添加 limits。之后创建资源：

```powershell
npx wrangler d1 create laf-production --config wrangler.production.json
npx wrangler r2 bucket create laf-images-production --config wrangler.production.json
```

将创建 D1 输出的 database_id 填入正式文件。图片桶保持私有，不开启 r2.dev 或桶的公开自定义域名。命令若询问是否自动更新配置，可拒绝并手工填写，避免重复 binding。

```powershell
npm run deploy:check
npm run deploy
node .\scripts\init-config.mjs
notepad .\.dev.vars
npx wrangler secret put ADMIN_BOOTSTRAP_KEY --config wrangler.production.json
```

secret 提示输入时粘贴 .dev.vars 内初始化密钥的值，不含变量名及引号。然后回到项目根目录执行 `Initialize-Admin.ps1 -ServerUrl "https://实际域名"`。打开 `https://实际域名/editor/` 确认管理员可以登录，再回到 laf-backend 删除云端初始化 secret：`npx wrangler secret delete ADMIN_BOOTSTRAP_KEY --config wrangler.production.json`。管理员创建组及只读管理账号，客户端填 HTTPS origin、提交设备申请并由管理员批准。云端新数据库不自动迁移本地记录和图片。

## 免费套餐云端验收（尚未执行）

本地 Wrangler/Miniflare 不执行云端 CPU 限制；本地通过不等于满足 10ms。正式配置的免费标记也不能证明实际账号没有付费订阅。上线前在 Cloudflare 控制台确认套餐；上线后查看 Worker Metrics 的错误与 CPU，以及 D1/R2 用量。可用 `npx wrangler tail --config wrangler.production.json` 查看运行异常。不要把本地请求耗时或网络延迟当成 CPU 时间。

在真实校园网络完成管理员初始化、登录/注销、编辑者注册与审批、修改密码、只读账号创建与重设密码、设备申请与批准、同步多页记录、最大允许图片上传和读取、认领后刷新、撤销设备后拒绝读取等检查。多次正常使用并检查是否出现 `1102` / `exceededCpu`；还需要等待至少一次每小时清理，检查 Scheduled 调用是否成功。日志留存依然默认 90 天，需安排备份。遇到 CPU 超限先定位操作并缩小批量，不能通过 sleep、waitUntil 或同一次调用内分阶段来重置 CPU，也不能为免费套餐减弱密码算法。

官方额度参考（2026-10-08）：Workers Free 100000 请求/日、HTTP 和 Cron 每次 10ms CPU；D1 500万行读取/日、10万行写入/日、账号总存储 5GB（单个免费数据库容量另有限制）；R2 Standard 每月 10GB-month、100万 Class A、1000万 Class B 操作免费。R2 超额仍可能收费，应用容量上限不能完全控制重复读取的操作费用。这些是共享的账号额度，其他项目也会占用，不承诺无限免费。客户端建议至少 5–15 分钟刷新一次；例如 100 台每 10 分钟刷新约 14400 个刷新周期/日，但每周期可能有状态检查、多页和图片请求，实际请求数会更多。

参考：[Workers CPU 与额度](https://developers.cloudflare.com/workers/platform/limits/) · [D1 价格](https://developers.cloudflare.com/d1/platform/pricing/) · [R2 价格](https://developers.cloudflare.com/r2/pricing/)。

## 本地开发

Start-Server.ps1 默认只监听 127.0.0.1；-Lan 自动选择一个私网接口，或用 -ListenAddress 指定私网 IP。脚本拒绝公网 IP 和 0.0.0.0，不应把开发端口经路由器、隧道或反向代理公开到互联网。正式服务使用上述 Workers 部署配置。

## API 和客户端升级

列表接口保留 success/data 数组格式，新增 pagination:{limit,snapshot,nextCursor}。物品、账号、访问组、只读账号和设备列表都分页；日志已有游标分页。物品支持 q 搜索与 status 筛选，搜索发生在服务端，能找到未加载页里的记录。snapshot 固定最大序号，阻止分页过程中新增记录混入；它不是数据库事务快照，其他人的状态修改可在后续刷新体现。

网页先加载 50 条，点击「加载更多记录」继续。管理员列表按页获取；只读 0.7.0 每次按最多 100 条顺序同步全部未认领记录，完整同步成功才写缓存，失败保留原快照，不保存不完整页。单页响应限制 2 MiB，本地记录总量限制 10000 条或 40 MiB。请升级旧客户端以避免只获取第一页。

## 验证

使用独立 .test-state 和 8790 测试服务运行 integration.mjs、devices-smoke.mjs、web-smoke.mjs。先 wrangler deploy --dry-run --outdir .test-build，再 node scripts/security-smoke.mjs：独立内存数据库验证 HTTPS、来源限制、请求流大小、分页、并发配额、日预算、删除队列和限流。桌面设备 GUI 测试验证两页 125 条完整缓存，pagination-gui-smoke.cjs 验证网页 50→100→125 条加载、搜索与筛选。

参考：[Cloudflare 自定义域名](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) · [关闭默认入口](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/) · [RateLimit 的地域与精度限制](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
