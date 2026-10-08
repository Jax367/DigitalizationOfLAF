const {app}=require('electron');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const output=path.resolve(__dirname,'../test-output/network',String(Date.now()));
app.setPath('userData',output);
let server,stored,denied=false,redirectTargetHits=0;
app.whenReady().then(async()=>{
 await fs.mkdir(output,{recursive:true});
 server=http.createServer(async(req,res)=>{
  if(req.url==='/redirect'){res.writeHead(302,{Location:'/target'});res.end();return;}
  if(req.url==='/target'){redirectTargetHits++;res.end('target');return;}
  res.setHeader('Content-Type','application/json');
  if(req.url==='/api/device/apply'){
   let text='';for await(const chunk of req)text+=chunk;stored=JSON.parse(text);
   assert.equal(stored.username,'fixture-reader');assert.equal(stored.password,'fixture-password-2026');assert.equal(stored.display_name,'网络测试设备');assert.match(stored.device_token,/^[a-f0-9]{64}$/);
   res.end(JSON.stringify({success:true,data:{status:'pending',display_name:stored.display_name,username:stored.username,account_enabled:1,group_enabled:1}}));return;
  }
  assert.equal(req.headers['x-device-token'],stored.device_token);
  if(denied){res.writeHead(403);res.end(JSON.stringify({success:false,error:'设备已撤销'}));return;}
  res.end(JSON.stringify({success:true,data:{status:'approved',display_name:stored.display_name,account_enabled:1,group_enabled:1}}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const device=require('../src/device-client.cjs')({root:()=>output,origin:()=>origin});
 assert.equal((await device.apply({username:'fixture-reader',password:'fixture-password-2026',display_name:'网络测试设备'})).status,'pending');
 assert.equal((await device.refresh()).status,'approved');assert.equal(await device.authorized(),true);
 const network=require('../src/network.cjs');await assert.rejects(network.json(origin+'/redirect'));assert.equal(redirectTargetHits,0);
 denied=true;await assert.rejects(device.refresh(),error=>error.status===403);assert.equal(await device.authorized(),false);
 console.log('Electron 网络检查通过：申请 JSON、加密设备令牌、审批同步、拒绝重定向、撤权');
 await new Promise(resolve=>server.close(resolve));app.exit(0);
}).catch(error=>{console.error(error);server?.close();app.exit(1);});
