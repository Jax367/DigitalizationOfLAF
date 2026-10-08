const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createTransport}=require('../src/network.cjs');
test('requests use explicit credentials and refuse redirects',async()=>{
 const transport=createTransport(async(url,options)=>{assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.headers['X-Device-Token'],'fixture');return Response.json({success:true,data:{status:'pending'}});});
 assert.equal((await transport.json('https://fixture.test',{headers:{'X-Device-Token':'fixture'}})).data.status,'pending');
});
test('DNS errors are understandable and do not expose request secrets',async()=>{
 const transport=createTransport(async()=>{throw new TypeError('fetch failed',{cause:{code:'ENOTFOUND'}});});await assert.rejects(transport.json('https://fixture.test'),/DNS/);
});
test('timeout covers response body and restores callers even if transport stalls',async()=>{
 const transport=createTransport(async()=>({body:new ReadableStream({start(){}})}),20);await assert.rejects(transport.json('https://fixture.test'),/超时/);
});
test('server permission errors preserve HTTP status and message',async()=>{
 const transport=createTransport(async()=>Response.json({success:false,error:'账号或密码错误'},{status:403}));await assert.rejects(transport.json('https://fixture.test'),error=>error.status===403&&error.message==='账号或密码错误');
});
test('Cloudflare HTML errors are not misreported as password or JSON failures',async()=>{
 const transport=createTransport(async()=>new Response('<html>Error 1102</html>',{status:500}));await assert.rejects(transport.json('https://fixture.test'),/HTTP 500/);
});
