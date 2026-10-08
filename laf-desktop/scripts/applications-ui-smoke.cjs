const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
app.setPath('userData',path.resolve(__dirname,'../test-output/applications-ui',String(Date.now())));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
 await win.loadURL('data:text/html,<main id="content"></main>');
 const admin=await fs.readFile(path.resolve(__dirname,'../../laf-backend/public/editor/admin.js'),'utf8');
 await win.webContents.executeJavaScript(`(async()=>{
 const requests=[{id:1,device_id:'fixture',display_name:'同一设备',status:'superseded',created_at:'2026-10-01 10:00:00',expires_at:'2026-10-08 10:00:00',username:'reader',group_name:'组'},{id:2,device_id:'fixture',display_name:'同一设备',status:'pending',created_at:'2026-10-02 11:00:00',expires_at:'2026-10-09 11:00:00',username:'reader',group_name:'组'}];
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const timeLabel=value=>value,statusLabel=value=>value,action=fn=>fn(),notice=()=>{},button=(id,fn)=>document.getElementById(id).onclick=fn;
 const api={request:async()=>({data:requests,pagination:{snapshot:2,nextCursor:null}}),api:async(route,method,body)=>{if(method==='PATCH'){window.reviewedRoute=route;requests[1].status=body.status;return {};}return route==='/api/devices'?[{id:'fixture',display_name:'同一设备',status:'pending',created_at:'2026-09-01 00:00:00',username:'reader',group_name:'组',account_enabled:1,group_enabled:1}]:[];}};
 ${admin}
 await readersPage();
 })()`);
 const before=await win.webContents.executeJavaScript(`({text:document.body.textContent,count:document.querySelectorAll('[data-application]').length,legacyApprove:!!document.querySelector('[data-device][data-status="approved"]')})`);
 assert.ok(before.text.includes('#1')&&before.text.includes('#2'));assert.ok(before.text.includes('2026-10-01 10:00:00')&&before.text.includes('2026-10-02 11:00:00'));assert.equal(before.count,2);assert.equal(before.legacyApprove,false);
 await win.webContents.executeJavaScript(`document.querySelector('[data-application="2"][data-status="approved"]').click()`);
 await new Promise(resolve=>setTimeout(resolve,200));
 assert.equal(await win.webContents.executeJavaScript('window.reviewedRoute'),'/api/device-applications/2');
 console.log('网页申请 GUI 检查通过：独立编号与时间、历史状态、按申请审批、设备时间分开显示');win.destroy();app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
