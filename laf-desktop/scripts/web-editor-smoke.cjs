const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {trayIcon}=require('../src/tray-icon.cjs');
const output=path.resolve(__dirname,'../test-output/web-editor'),base='http://127.0.0.1:8790';
app.setPath('userData',path.join(output,`profile-${Date.now()}`));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));let itemId,fixtureId,token;
async function http(route,method='GET',body){const response=await fetch(base+route,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const json=await response.json();if(!json.success)throw Error(json.error);return json.data;}
async function wait(fn,label){for(let i=0;i<150;i++){if(await fn())return;await delay(100);}throw Error('Timeout: '+label);}
async function createPage(partition){const win=new BrowserWindow({show:false,width:1180,height:900,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,partition}});await win.loadURL(base+'/editor/');return win;}
async function run(){
 await fs.mkdir(output,{recursive:true});await app.whenReady();
 token=(await http('/api/auth/login','POST',{username:'integration-admin',password:'Integration-password-2026'})).token;
 const credentials={username:`web-gui-${Date.now()}`,password:'Web-GUI-password-2026'};
 fixtureId=(await http('/api/auth/register','POST',credentials)).id;await http(`/api/users/${fixtureId}`,'PATCH',{approval_status:'approved'});
 const win=await createPage('admin-'+Date.now()),js=code=>win.webContents.executeJavaScript(code,true);
 const errors=[];win.webContents.on('console-message',(_,details)=>{if(details.level==='error')errors.push(details.message);});
 await wait(()=>js('Boolean(document.querySelector("#auth-form"))'),'web login form');
 assert.equal(await js('typeof window.laf'),'undefined');assert.equal(await js('typeof require'),'undefined');
 await js('document.querySelector("#username").value="integration-admin";document.querySelector("#password").value="Integration-password-2026";document.querySelector("#auth-form").requestSubmit()');
 await wait(()=>js('Boolean(document.querySelector("#nav-users"))'),'admin login');
 await js('document.querySelector("#new-item").click()');await wait(()=>js('Boolean(document.querySelector("#item-form"))'),'publish form');
 await js('document.querySelector("#title").value="网页 GUI 测试物品";document.querySelector("#description").value="初始描述";document.querySelector("#floor").value="三层";HTMLInputElement.prototype.click=function(){ if(this.type!=="file")HTMLElement.prototype.click.call(this); };document.querySelector("#upload-image").click()');
 const bytes=[...trayIcon(true)];
 await js(`{const input=document.querySelector('#web-file-picker');const data=new DataTransfer();data.items.add(new File([new Uint8Array(${JSON.stringify(bytes)})],'web-image.png',{type:'image/png'}));input.files=data.files;input.dispatchEvent(new Event('change'));}`);
 await wait(()=>js('document.querySelector("#upload-name").textContent === "web-image.png"'),'browser upload preview');
 await delay(300);await fs.writeFile(path.join(output,'publish.png'),(await win.capturePage()).toPNG());
 await js('document.querySelector("#item-form").requestSubmit()');await wait(()=>js('!document.querySelector("dialog").open'),'publish save');
 itemId=(await http('/api/items')).find(item=>item.title==='网页 GUI 测试物品').id;
 await wait(()=>js(`Boolean(document.querySelector('[data-id="${itemId}"]'))`),'item list');
 await js(`document.querySelector('[data-id="${itemId}"]').click()`);await wait(()=>js('Boolean(document.querySelector("#edit-item"))'),'details');
 await js('document.querySelector("#edit-item").click()');await wait(()=>js('Boolean(document.querySelector("#item-form"))'),'edit form');
 await js('document.querySelector("#description").value="网页修改后的描述";document.querySelector("#status").value="claimed";document.querySelector("#item-form").requestSubmit()');await wait(()=>js('!document.querySelector("dialog").open'),'update save');
 assert.equal((await http(`/api/items/${itemId}`)).description,'网页修改后的描述');
 await js('document.querySelector("#filter").value="all";document.querySelector("#filter").dispatchEvent(new Event("change"))');
 await wait(()=>js(`Boolean(document.querySelector('[data-claim="${itemId}"]'))`),'claim checkbox');
 assert.equal(await js(`document.querySelector('[data-claim="${itemId}"]').checked`),true);
 await js(`document.querySelector('[data-claim="${itemId}"]').click()`);
 await wait(async()=> (await http(`/api/items/${itemId}`)).status==='found','undo claim');
 await wait(()=>js(`!document.querySelector('[data-claim="${itemId}"]').disabled`),'claim ready');
 await js(`document.querySelector('[data-claim="${itemId}"]').click()`);
 await wait(async()=> (await http(`/api/items/${itemId}`)).status==='claimed','one-click claim');
 assert.equal(await js('document.querySelector("dialog").open'),false);
 await js('window.confirm=()=>true;document.querySelector("#nav-users").click()');await wait(()=>js(`Boolean(document.querySelector('[data-user="${fixtureId}"][data-edit="false"]'))`),'permission page');
 await js(`document.querySelector('[data-user="${fixtureId}"][data-edit="false"]').click()`);await wait(()=>js(`Boolean(document.querySelector('[data-user="${fixtureId}"][data-edit="true"]'))`),'revoke edit permission');
 await delay(300);await fs.writeFile(path.join(output,'permissions.png'),(await win.capturePage()).toPNG());
 await js('document.querySelector("#nav-logs").click()');await wait(()=>js('Boolean(document.querySelector("#log-filter"))'),'audit filter');
 await js('document.querySelector("#log-filter [name=action]").value="item.update";document.querySelector("#log-filter").requestSubmit()');
 await wait(()=>js(`document.querySelector('#log-rows')?.textContent.includes('items/${itemId}') && [...document.querySelectorAll('#log-rows tr')].every(row=>row.children[2].textContent==='修改记录/认领状态')`),'filtered audit log');
 await delay(300);await fs.writeFile(path.join(output,'logs.png'),(await win.capturePage()).toPNG());
 const logs=await http('/api/logs?action=item.update');const log=logs.find(log=>log.target===`items/${itemId}`);assert.equal(JSON.parse(log.details).after.description,'网页修改后的描述');
 await win.reload();await wait(()=>js('Boolean(document.querySelector("#nav-users"))'),'cookie login survives reload');
 const editorWin=await createPage('revoked-'+Date.now()),edit=code=>editorWin.webContents.executeJavaScript(code,true);
 await wait(()=>edit('Boolean(document.querySelector("#auth-form"))'),'editor login');
 await edit(`document.querySelector('#username').value='${credentials.username}';document.querySelector('#password').value='${credentials.password}';document.querySelector('#auth-form').requestSubmit()`);
 await wait(()=>edit('document.querySelector("#content")?.textContent.includes("编辑权限已被管理员撤销")'),'read-only permission banner');
 assert.equal(await edit('document.querySelector("#new-item").hidden'),true);
 assert.equal(await edit(`fetch('/api/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'禁止写入',status:'found'})}).then(response=>response.status)`),403);
 // The deliberately rejected request produces a browser network error; successful admin workflows must be clean.
 assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify({success:true,checks:['ordinary-web-page','cookie-login','file-upload','publish-and-edit','admin-revoke','audit-query-and-diff','reload-session','revoked-editor-read-only','server-write-denial']},null,2));
 console.log('网页 GUI 验证通过：浏览器会话、上传发布、修改、管理员撤销权限、日志筛选与前后内容、刷新保留登录、撤权后只读和服务端拦截');
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(itemId){const record=await http(`/api/items/${itemId}`).catch(()=>null);await http(`/api/items/${itemId}`,'DELETE').catch(()=>{});if(record?.image_id)await http(`/api/images/${record.image_id}`,'DELETE').catch(()=>{});}if(fixtureId)await http(`/api/users/${fixtureId}`,'PATCH',{approval_status:'disabled'}).catch(()=>{});app.exit(process.exitCode||0);});
