const {safeStorage}=require('electron');
const {randomUUID,randomBytes,createHash}=require('node:crypto');
const path=require('node:path'),os=require('node:os');
const storage=require('./storage.cjs');
const network=require('./network.cjs');
module.exports=({root,origin})=>{
 const file=()=>path.join(root(),'devices',createHash('sha256').update(origin()).digest('hex')+'.json');
 async function load(){return await storage.readJson(file(),null);}
 async function save(device){await storage.writeJson(file(),device);return device;}
 const token=device=>safeStorage.decryptString(Buffer.from(device.encryptedToken,'base64'));
 const publicInfo=device=>device?{display_name:device.display_name,username:device.username,group_name:device.group_name,status:device.status,account_enabled:device.account_enabled,group_enabled:device.group_enabled}:{display_name:os.hostname(),status:'unregistered'};
 const allowed=device=>device?.status==='approved'&&!!device.account_enabled&&!!device.group_enabled;
 async function call(route,options={}){
  return (await network.json(origin()+route,options)).data;
 }
 return {
  info:async()=>{const device=await load();if(device){try{token(device);}catch{return {...publicInfo(device),status:'credential_invalid'};}}return publicInfo(device);},
  authorized:async()=>{const device=await load();if(!allowed(device))return false;try{token(device);return true;}catch{return false;}},
  headers:async()=>{const device=await load();return device?{'X-Device-Token':token(device)}:{};},
  async apply(input){
   if(!safeStorage.isEncryptionAvailable())throw new Error('系统凭据加密不可用，无法保存设备授权');
   if(!input||typeof input.display_name!=='string'||!input.display_name.trim())throw new Error('请输入设备显示名称');
   let device=await load();if(device){try{token(device);}catch{device=null;}}
   if(!device){device=await save({id:randomUUID(),encryptedToken:safeStorage.encryptString(randomBytes(32).toString('hex')).toString('base64'),status:'unregistered',display_name:input.display_name});}
   const data=await call('/api/device/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:input.username,password:input.password,display_name:input.display_name,device_id:device.id,device_token:token(device)})});
   await save({...device,...data});return publicInfo(data);
  },
  async refresh(){
   const device=await load();if(!device)return publicInfo(null);
   try{const data=await call('/api/device/status',{headers:{'X-Device-Token':token(device)}});await save({...device,...data});return publicInfo(data);}
   catch(error){if(error.status===401||error.status===403)await save({...device,status:'revoked'});throw error;}
  },
  async block(){const device=await load();if(device)await save({...device,status:'revoked'});},
 };
};
