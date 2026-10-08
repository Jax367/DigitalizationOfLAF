import {paginateSql} from '../utils/pagination';
import type {Env} from '../types';
import {digest,hashPassword,requireUser,throttle,validatePassword,verifyPassword} from '../services/auth';
import {deviceIdentity} from '../services/devices';
import {reviewApplication} from '../services/applications';
import {HttpError,methodNotAllowed,parseId,readBody,requiredText,success} from '../utils/http';
function name(value:unknown,label:string,max=80){const text=requiredText(value,label).trim();if(text.length>max)throw new HttpError(400,label+'过长');return text;}
export async function devicesRoute(request:Request,env:Env,path:string):Promise<Response>{
 const db=env.DB;
 if(path==='/api/device/applications'){
  if(request.method!=='GET')return methodNotAllowed('GET');const device=await deviceIdentity(request,env);
  return paginateSql(request,db,"SELECT id AS _cursor,id,display_name,status,created_at,expires_at,reviewed_at FROM device_applications WHERE device_id=? AND (status<>'pending' OR expires_at>CURRENT_TIMESTAMP)",[device.id]);
 }
 if(path==='/api/device/status'){
  if(request.method!=='GET')return methodNotAllowed('GET');return success(await deviceIdentity(request,env));
 }
 if(path==='/api/device/apply'){
  if(request.method!=='POST')return methodNotAllowed('POST');
  await throttle(env,'device-ip:'+ (request.headers.get('CF-Connecting-IP')??'local'),20);
  const body=await readBody(request,['username','password','display_name','device_id','device_token']);
  const username=name(body.username,'账号',40);await throttle(env,'device-account:'+username,10);
  const account=await db.prepare('SELECT a.*,g.enabled AS group_enabled FROM reader_accounts a JOIN access_groups g ON g.id=a.group_id WHERE a.username=?').bind(username).first<{id:number;password_hash:string;enabled:number;group_enabled:number}>();
  const valid=await verifyPassword(validatePassword(body.password),account?.password_hash??('pbkdf2$100000$'+'0'.repeat(32)+'$'+'0'.repeat(64)));
  if(!account||!valid)throw new HttpError(401,'只读管理账号或密码错误');if(!account.enabled||!account.group_enabled)throw new HttpError(403,'账号或访问组已停用');
  if(typeof body.device_id!=='string'||!/^[a-f0-9-]{36}$/.test(body.device_id)||typeof body.device_token!=='string'||!/^[a-f0-9]{64}$/.test(body.device_token))throw new HttpError(400,'无效设备身份');
  const tokenHash=await digest(body.device_token),display=name(body.display_name,'设备显示名称');
  const old=await db.prepare('SELECT token_hash,status FROM reader_devices WHERE id=?').bind(body.device_id).first<{token_hash:string;status:string}>();
  if(old&&old.token_hash!==tokenHash)throw new HttpError(409,'设备身份冲突');
  if(old?.status==='approved')throw new HttpError(409,'设备已批准，无需重复申请');
  try{
   const result=await db.batch([
    db.prepare("INSERT INTO reader_devices(id,token_hash,account_id,display_name,status) VALUES(?,?,?,?,'pending') ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id,display_name=excluded.display_name,status='pending',reviewed_at=NULL WHERE reader_devices.token_hash=excluded.token_hash AND reader_devices.status<>'approved'").bind(body.device_id,tokenHash,account.id,display),
    db.prepare("INSERT INTO device_applications(device_id,account_id,display_name) SELECT id,account_id,display_name FROM reader_devices WHERE id=? AND token_hash=? AND status='pending' RETURNING id").bind(body.device_id,tokenHash),
   ]);if(!result[1]!.results.length)throw new HttpError(409,'设备身份或授权状态已变化，请检查审批状态');
  }catch(error){const message=String(error);if(message.includes('device_apply_cooldown'))throw new HttpError(429,'同一设备每 5 分钟只能提交一次申请，请先检查审批状态');if(message.includes('device_apply_account_limit'))throw new HttpError(429,'此账号申请过于频繁（最多 20 次/小时、100 次/天），请稍后重试');throw error;}
  return success(await deviceIdentity(new Request(request.url,{headers:{'X-Device-Token':body.device_token}}),env),201);
 }
 const admin=await requireUser(request,env,true);
 if(path==='/api/device-applications'){
  if(request.method!=='GET')return methodNotAllowed('GET');
  return paginateSql(request,db,"SELECT r.id AS _cursor,r.id,r.device_id,r.display_name,r.status,r.created_at,r.expires_at,r.reviewed_at,a.username,g.name AS group_name FROM device_applications r JOIN reader_accounts a ON a.id=r.account_id JOIN access_groups g ON g.id=a.group_id WHERE r.status<>'pending' OR r.expires_at>CURRENT_TIMESTAMP");
 }
 const applicationMatch=/^\/api\/device-applications\/(\d+)$/.exec(path);
 if(applicationMatch){if(request.method!=='PATCH')return methodNotAllowed('PATCH');const body=await readBody(request,['status']);if(!['approved','rejected'].includes(String(body.status)))throw new HttpError(400,'审批状态错误');return reviewApplication(env,parseId(applicationMatch[1]!),String(body.status),admin.id);}
 if(path==='/api/access-groups'){
  if(request.method==='GET')return paginateSql(request,db,'SELECT id AS _cursor,* FROM access_groups');
  if(request.method==='POST'){const b=await readBody(request,['name']);const groupName=name(b.name,'组名称');if(await db.prepare('SELECT id FROM access_groups WHERE name=?').bind(groupName).first())throw new HttpError(409,'组名称已存在');const result=await db.batch([db.prepare('INSERT INTO access_groups(name) VALUES(?) RETURNING *').bind(groupName),db.prepare("INSERT INTO logs(user_id,action,target,details) SELECT ?,'group.create','groups/'||id,json_object('name',name,'enabled',enabled) FROM access_groups WHERE id=last_insert_rowid()").bind(admin.id)]);return success(result[0]!.results[0],201);}
  return methodNotAllowed('GET, POST');
 }
 const groupMatch=/^\/api\/access-groups\/(\d+)$/.exec(path);
 if(groupMatch){if(request.method!=='PATCH')return methodNotAllowed('PATCH');const id=parseId(groupMatch[1]!);const b=await readBody(request,['enabled']);if(typeof b.enabled!=='boolean')throw new HttpError(400,'需要指定启用状态');if(!await db.prepare('SELECT id FROM access_groups WHERE id=?').bind(id).first())throw new HttpError(404,'组不存在');const result=await db.batch([db.prepare('UPDATE access_groups SET enabled=? WHERE id=? RETURNING id,name,enabled').bind(b.enabled?1:0,id),db.prepare("INSERT INTO logs(user_id,action,target,details) VALUES(?,'group.update',?,?)").bind(admin.id,'groups/'+id,JSON.stringify({enabled:b.enabled}))]);return success(result[0]!.results[0]);}
 if(path==='/api/reader-accounts'){
  if(request.method==='GET')return paginateSql(request,db,'SELECT a.id AS _cursor,a.id,a.username,a.group_id,a.enabled,a.created_at,g.name AS group_name FROM reader_accounts a JOIN access_groups g ON g.id=a.group_id');
  if(request.method==='POST'){
   const b=await readBody(request,['username','password','group_id']);const username=name(b.username,'用户名',40);if(!/^[\p{L}\p{N}_-]{3,40}$/u.test(username))throw new HttpError(400,'用户名格式错误');const group=parseId(String(b.group_id));if(!await db.prepare('SELECT id FROM access_groups WHERE id=? AND enabled=1').bind(group).first())throw new HttpError(400,'组不存在或已停用');
   if(await db.prepare('SELECT id FROM reader_accounts WHERE username=?').bind(username).first())throw new HttpError(409,'只读管理账号已存在');
   const result=await db.batch([db.prepare('INSERT INTO reader_accounts(username,password_hash,group_id) VALUES(?,?,?) RETURNING id,username,group_id,enabled').bind(username,await hashPassword(validatePassword(b.password)),group),db.prepare("INSERT INTO logs(user_id,action,target,details) SELECT ?,'reader.create','reader-accounts/'||id,json_object('username',username,'group_id',group_id) FROM reader_accounts WHERE id=last_insert_rowid()").bind(admin.id)]);return success(result[0]!.results[0],201);
  }return methodNotAllowed('GET, POST');
 }
 const accountMatch=/^\/api\/reader-accounts\/(\d+)$/.exec(path);
 if(accountMatch){
  if(request.method!=='PATCH')return methodNotAllowed('PATCH');const id=parseId(accountMatch[1]!);const b=await readBody(request,['enabled','password']);if(b.enabled===undefined&&b.password===undefined)throw new HttpError(400,'需要指定修改内容');if(b.enabled!==undefined&&typeof b.enabled!=='boolean')throw new HttpError(400,'启用状态格式错误');
  const old=await db.prepare('SELECT id,enabled,password_hash FROM reader_accounts WHERE id=?').bind(id).first<{id:number;enabled:number;password_hash:string}>();if(!old)throw new HttpError(404,'账号不存在');
  await db.batch([db.prepare('UPDATE reader_accounts SET enabled=?,password_hash=? WHERE id=?').bind(b.enabled===undefined?old.enabled:b.enabled?1:0,b.password===undefined?old.password_hash:await hashPassword(validatePassword(b.password)),id),db.prepare("INSERT INTO logs(user_id,action,target,details) VALUES(?,'reader.update',?,?)").bind(admin.id,'reader-accounts/'+id,JSON.stringify({enabled:b.enabled??!!old.enabled,password_reset:b.password!==undefined}))]);return success({id});
 }
 if(path==='/api/devices'){
  if(request.method!=='GET')return methodNotAllowed('GET');return paginateSql(request,db,'SELECT d.rowid AS _cursor,d.id,d.display_name,d.status,d.created_at,d.reviewed_at,a.username,a.group_id,a.enabled AS account_enabled,g.name AS group_name,g.enabled AS group_enabled FROM reader_devices d JOIN reader_accounts a ON a.id=d.account_id JOIN access_groups g ON g.id=a.group_id');
 }
 const match=/^\/api\/devices\/([a-f0-9-]{36})$/.exec(path);
 if(match){
  if(request.method!=='PATCH')return methodNotAllowed('PATCH');const b=await readBody(request,['status']);if(!['approved','rejected','revoked'].includes(String(b.status)))throw new HttpError(400,'审批状态错误');
  const old=await db.prepare('SELECT status FROM reader_devices WHERE id=?').bind(match[1]).first<{status:string}>();if(!old)throw new HttpError(404,'设备不存在');
  if(b.status!=='revoked'&&old.status==='pending'){
   const latest=await db.prepare("SELECT id FROM device_applications WHERE device_id=? AND status='pending' AND expires_at>CURRENT_TIMESTAMP ORDER BY id DESC LIMIT 1").bind(match[1]).first<{id:number}>();
   if(!latest)throw new HttpError(409,'申请已过期，请让设备重新申请');return reviewApplication(env,latest.id,String(b.status),admin.id);
  }
  await db.batch([db.prepare('UPDATE reader_devices SET status=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?').bind(b.status,match[1]),db.prepare("UPDATE device_applications SET status='superseded' WHERE device_id=? AND status='pending'").bind(match[1]),db.prepare("INSERT INTO logs(user_id,action,target,details) VALUES(?,'device.review',?,?)").bind(admin.id,'devices/'+match[1],JSON.stringify({before:old.status,after:b.status}))]);return success({id:match[1],status:b.status});
 }
 throw new HttpError(404,'接口不存在');
}
