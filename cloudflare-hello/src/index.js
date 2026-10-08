// 改这里的文字，再执行 npm run deploy，即可练习更新上线。
const greeting = "你好，Cloudflare！";

export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/hello") {
      return Response.json({
        message: greeting,
        time: new Date().toISOString(),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    if (pathname !== "/") {
      return new Response("Not found", { status: 404 });
    }

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
};

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>我的第一个 Cloudflare 程序</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f5f6f8; color: #18212f; margin: 0; padding: 72px 24px; }
    main { max-width: 560px; margin: auto; padding: 32px; background: white; border: 1px solid #e5e7eb; border-radius: 16px; }
    h1 { font-size: 28px; } p { line-height: 1.7; color: #566174; }
    button { background: #e8580c; color: white; border: 0; border-radius: 8px; padding: 12px 20px; font: inherit; cursor: pointer; }
    button:disabled { opacity: .6; cursor: wait; }
    pre { background: #f5f6f8; padding: 16px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <p>我的第一个 Cloudflare Worker</p>
    <h1>Hello, Cloudflare!</h1>
    <p>页面已经运行。点击按钮，请求服务器，查看问候语与服务器时间。</p>
    <button id="hello">请求服务器</button>
    <pre id="result" role="status" aria-live="polite">等待请求……</pre>
  </main>
  <script>
    const button = document.querySelector('#hello');
    const result = document.querySelector('#result');
    button.addEventListener('click', async () => {
      button.disabled = true;
      result.textContent = '请求中……';
      try {
        const response = await fetch('/api/hello');
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        result.textContent = data.message + '\\n服务器时间：' + data.time;
      } catch (error) {
        result.textContent = '请求失败：' + error.message;
      } finally {
        button.disabled = false;
      }
    });
  </script>
</body>
</html>`;
