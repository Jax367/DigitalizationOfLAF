const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const storage=require('../src/storage.cjs');
const output=path.resolve(__dirname,'../test-output/devices');process.env.LAF_TEST_PROFILE=path.join(output,'profile-'+Date.now());
const base='http://127.0.0.1:8790',suffix=Date.now(),password='GUI-reader-password-2026';let token,itemId,accountId,groupId;
const delay=ms=>new Promise(r=>setTimeout(r,ms));async function wait(fn){for(let i=0;i<180;i++){if(await fn())return;await delay(100);}throw Error('Device GUI timeout');}
async function http(route,method='GET',body){const r=await fetch(base+route,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const p=await r.json();if(!p.success)throw Error(p.error);return p.data;}
(async()=>{
 await fs.mkdir(output,{recursive:true});await storage.writeJson(path.join(process.env.LAF_TEST_PROFILE,'settings.json'),{...storage.defaults,serverUrl:base});await app.whenReady();
 token=(await http('/api/auth/login','POST',{username:'integration-admin',password:'Integration-password-2026'})).token;
 itemId=(await http('/api/items','POST',{title:'设备授权 GUI 验证物品',description:'仅授权设备可读',status:'found'})).id;
 const admin=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,partition:'device-admin-'+suffix}});await admin.loadURL(base+'/editor/');const web=code=>admin.webContents.executeJavaScript(code,true);
 await wait(()=>web('Boolean(document.querySelector("#auth-form"))'));
 await web('document.querySelector("#username").value="integration-admin";document.querySelector("#password").value="Integration-password-2026";document.querySelector("#auth-form").requestSubmit()');await wait(()=>web('Boolean(document.querySelector("#nav-readers"))'));
 await web('window.confirm=()=>true;document.querySelector("#nav-readers").click()');await wait(()=>web('Boolean(document.querySelector("#create-group"))'));
 await web('document.querySelector("#create-group").click()');await wait(()=>web('Boolean(document.querySelector("#group-form"))'));await web('document.querySelector("#group-form").group_name.value="GUI组-'+suffix+'";document.querySelector("#group-form").requestSubmit()');await wait(()=>web('!document.querySelector("dialog").open'));
 groupId=(await http('/api/access-groups')).find(g=>g.name==='GUI组-'+suffix).id;
 await web('document.querySelector("#create-reader").click()');await wait(()=>web('Boolean(document.querySelector("#reader-form"))'));
 await web('document.querySelector("#reader-form").username.value="gui-reader-'+suffix+'";document.querySelector("#reader-form").password.value="'+password+'";document.querySelector("#reader-form").group_id.value="'+groupId+'";document.querySelector("#reader-form").requestSubmit()');await wait(()=>web('!document.querySelector("dialog").open'));accountId=(await http('/api/reader-accounts')).find(a=>a.username==='gui-reader-'+suffix).id;
 require(path.resolve(__dirname,'../../laf-viewer/src/main.cjs'));await wait(()=>BrowserWindow.getAllWindows().length===2);const viewer=BrowserWindow.getAllWindows().find(w=>w!==admin),read=code=>viewer.webContents.executeJavaScript(code,true);
 await wait(()=>read('Boolean(document.querySelector("#storage-open"))'));assert.equal(await read('document.querySelectorAll(".record").length'),0);
 await read('document.querySelector("#storage-open").click()');await wait(()=>read('Boolean(document.querySelector("#device-apply-form"))'));
 await read('document.querySelector("#device-apply-form").display_name.value="三层教室显示屏";document.querySelector("#device-apply-form").username.value="gui-reader-'+suffix+'";document.querySelector("#device-apply-form").password.value="'+password+'";document.querySelector("#device-apply-form").requestSubmit()');await wait(()=>read('document.querySelector("#device-state").textContent.includes("等待管理员批准")'));
 assert.equal(await read('document.querySelector("#device-apply-form").password.value'),'');assert.equal(await read('document.querySelectorAll(".record").length'),0);
 const identityFiles=await fs.readdir(path.join(process.env.LAF_TEST_PROFILE,'devices'));const identity=JSON.parse(await fs.readFile(path.join(process.env.LAF_TEST_PROFILE,'devices',identityFiles[0]),'utf8'));assert.ok(identity.encryptedToken);assert.ok(!JSON.stringify(identity).includes(password));assert.equal(typeof identity.device_token,'undefined');
 await web('document.querySelector("#refresh-readers").click()');await wait(()=>web(`Boolean(document.querySelector('[data-device="${identity.id}"][data-status="approved"]'))`));assert.ok(await web('document.querySelector("#content").textContent.includes("三层教室显示屏")'));
 await web(`document.querySelector('[data-device="${identity.id}"][data-status="approved"]').click()`);await wait(()=>web(`Boolean(document.querySelector('[data-device="${identity.id}"][data-status="revoked"]'))`));
 await read('document.querySelector("#device-refresh").click()');await wait(()=>read(`Boolean(document.querySelector('[data-id="${itemId}"]'))`));
 await read('document.querySelector("#modal-close").click()');viewer.showInactive();await delay(200);await fs.writeFile(path.join(output,'approved-viewer.png'),(await viewer.capturePage()).toPNG());viewer.hide();
 const originalFetch=global.fetch;
 const fixtureItems=[...Array.from({length:124},(_,i)=>({id:100124-i,title:'分页缓存物品'+i,description:'',floor:'',status:'found',created_at:'2026-10-07 00:00:00',image_id:null})),{id:itemId,title:'设备授权 GUI 验证物品',description:'',floor:'',status:'found',created_at:'2026-10-07 00:00:00',image_id:null}];let pages=0;
 global.fetch=async (url,options)=>{if(String(url).startsWith(base+'/api/items?')){const before=new URL(url).searchParams.get('before');pages++;return new Response(JSON.stringify({success:true,data:before?fixtureItems.slice(100):fixtureItems.slice(0,100),pagination:{snapshot:100124,nextCursor:before?null:100025}}),{headers:{'Content-Type':'application/json'}});}return originalFetch(url,options);};
 try{const paged=await read('window.laf.records(true)');assert.equal(paged.items.length,125);assert.equal(pages,2);}finally{global.fetch=originalFetch;}
 const realFetch=global.fetch;global.fetch=async url=>{if(String(url).startsWith(base+'/api/device/status')||String(url).startsWith(base+'/api/items'))throw Error('模拟断网');return realFetch(url);};
 try{const cached=await read('window.laf.records(true)');assert.ok(cached.offline);assert.ok(cached.items.some(i=>i.id===itemId));}finally{global.fetch=realFetch;}
 await web(`document.querySelector('[data-device="${identity.id}"][data-status="revoked"]').click()`);await wait(()=>web(`Boolean(document.querySelector('[data-device="${identity.id}"][data-status="approved"]'))`));
 await read('document.querySelector("#refresh").click()');await wait(()=>read('document.querySelectorAll(".record").length===0'));assert.deepEqual((await read('window.laf.records(false)')).items,[]);
 await read('document.querySelector("#storage-open").click()');await wait(()=>read('document.querySelector("#device-state").textContent.includes("已撤销")'));
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify({success:true,checks:['admin-create-group','admin-create-reader-account','named-device-apply','password-not-stored','pending-no-data','approve-and-sync','encrypted-device-credential','offline-approved-cache','revoke-hides-cache']},null,2));
 console.log('设备 GUI 验证通过：创建组/账号、显示名称申请、审批同步、加密凭据、断网缓存、撤权后停止展示');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(itemId)await http('/api/items/'+itemId,'DELETE').catch(()=>{});if(accountId)await http('/api/reader-accounts/'+accountId,'PATCH',{enabled:false}).catch(()=>{});if(groupId)await http('/api/access-groups/'+groupId,'PATCH',{enabled:false}).catch(()=>{});app.exit(process.exitCode||0);});
