// Chromium networking follows the system proxy/PAC configuration. Keep credentials
// explicit and never follow redirects carrying device tokens or account passwords.
function networkError(error) {
  if (error.status) return error;
  const code = String(error.cause?.code || error.code || error.message || '');
  if (error.name === 'TimeoutError' || error.name === 'AbortError' || /TIMED?_?OUT|TIMEOUT/i.test(code)) return new Error('连接服务器超时。请在浏览器检查服务器地址是否可访问；申请可能已送达，请先检查审批状态。');
  if (/ENOTFOUND|EAI_AGAIN|NAME_NOT_RESOLVED/i.test(code)) return new Error('无法解析服务器地址，请检查地址和网络 DNS。');
  if (/CERT|TLS|SSL/i.test(code)) return new Error('服务器 HTTPS 证书验证失败，请检查系统时间和服务器证书。');
  if (/PROXY/i.test(code)) return new Error('系统代理连接失败，请检查 Windows 网络代理设置。');
  return new Error('无法连接服务器，请用浏览器检查服务器地址和当前网络。');
}
function createTransport(fetcher, timeoutMs = 15000) {
  async function withResponse(url, options, consume) {
    const controller = new AbortController(); let timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { const error = new Error('timeout'); error.name = 'TimeoutError'; controller.abort(); reject(error); }, timeoutMs); });
    try {
      return await Promise.race([Promise.resolve().then(() => fetcher(url, { ...options, credentials: 'omit', redirect: 'error', signal: controller.signal })).then(consume), deadline]);
    } catch (error) { throw networkError(error); }
    finally { clearTimeout(timer); }
  }
  async function json(url, options = {}) {
    return withResponse(url, options, async response => {
      const reader = response.body.getReader(), chunks = []; let size = 0;
      while (true) { const {done, value} = await reader.read(); if (done) break; size += value.byteLength; if (size > 2 * 1024 * 1024) { await reader.cancel(); const error = new Error('服务器响应过大'); error.status = 413; throw error; } chunks.push(value); }
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { const error = new Error(`服务器返回非预期内容（HTTP ${response.status}），请检查服务运行日志。`); error.status = response.status; throw error; }
      if (!response.ok || !payload?.success) { const error = new Error(typeof payload?.error === 'string' ? payload.error : `服务器返回 ${response.status}`); error.status = response.status; throw error; }
      return payload;
    });
  }
  return { withResponse, json };
}
const transport = createTransport((...args) => require('electron').net.fetch(...args));
module.exports = { ...transport, createTransport };
