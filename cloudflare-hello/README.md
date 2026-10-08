# 最简 Cloudflare 部署练习

一个 JavaScript 文件同时提供网页和 `/api/hello` 接口。无需数据库、域名或前端构建工具。部署使用 Cloudflare Workers，命令行工具叫 Wrangler。

## 1. 本地运行

准备 Node.js 22.12+（建议受支持的 LTS 版本）和 Cloudflare 账号。在 PowerShell 执行：

```powershell
cd D:\develop\develop\LAF_seewo\cloudflare-hello
npm install
npm run dev
```

打开 http://localhost:8790，点击「请求服务器」，应该看到问候语和服务器时间。此时程序只在本机运行。按 Ctrl+C 停止服务后继续下面的步骤。

## 2. 登录 Cloudflare

```powershell
npm run login
```

在自动打开的浏览器中登录并授权 Wrangler。完成后回到终端。不需要把账号密码或 API Token 写进代码。

## 3. 部署上线

```powershell
npm run deploy
```

首次部署按提示完成账号选择或 workers.dev 子域名设置。成功后终端会输出类似 `https://cloudflare-hello.<你的子域名>.workers.dev` 的地址，以实际输出为准。

打开该地址并点击按钮。现在网页和接口都在 Cloudflare 运行，其他人也可通过这个网址访问。也可以直接访问该地址的 `/api/hello` 查看 JSON。

注意：`wrangler.jsonc` 的 `name` 是云端 Worker 名称。同一账号下同名部署会更新已有 Worker；如果已有同名项目，先改成一个新名称。

## 4. 练习更新

把 `src/index.js` 第一行变量 `greeting` 的文字改为「这是我的第二次部署」，保存后执行：

```powershell
npm run deploy
```

刷新线上网页，再点击按钮，验证新问候语。网址保持不变。

## 文件说明

- `src/index.js`：网页与接口代码。
- `wrangler.jsonc`：云端项目名称、入口文件和兼容日期。
- `package.json`：本地运行、登录、部署命令。

`npm run check` 仅检查部署打包，不上传。练习完成后，可在 Cloudflare 控制台的 Workers & Pages 中找到 `cloudflare-hello`，进入设置删除这个练习 Worker。

如果部署显示未登录，重新运行 `npm run login`。如果线上请求无法访问，先检查终端是否确实显示部署成功，以及使用的是否为终端输出的网址。

官方教程：https://developers.cloudflare.com/workers/get-started/guide/
