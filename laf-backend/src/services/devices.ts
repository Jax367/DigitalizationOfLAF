import type {Env,PublicUser} from '../types';
import {digest,requireUser,sessionToken} from './auth';
import {HttpError} from '../utils/http';
export interface ReaderDevice {id:string;display_name:string;status:string;account_id:number;username:string;account_enabled:number;group_id:number;group_name:string;group_enabled:number}
export async function deviceIdentity(request:Request,env:Env):Promise<ReaderDevice>{
 const token=request.headers.get('X-Device-Token');if(!token||!/^[a-f0-9]{64}$/.test(token))throw new HttpError(401,'请申请设备授权');
 const device=await env.DB.prepare('SELECT d.id,d.display_name,d.status,d.account_id,a.username,a.enabled AS account_enabled,a.group_id,g.name AS group_name,g.enabled AS group_enabled FROM reader_devices d JOIN reader_accounts a ON a.id=d.account_id JOIN access_groups g ON g.id=a.group_id WHERE d.token_hash=?').bind(await digest(token)).first<ReaderDevice>();
 if(!device)throw new HttpError(401,'设备授权无效，请重新申请');return device;
}
export async function requireReadAccess(request:Request,env:Env):Promise<{user?:PublicUser;device?:ReaderDevice}>{
 if(sessionToken(request))return {user:await requireUser(request,env)};
 const device=await deviceIdentity(request,env);
 if(device.status!=='approved'||!device.account_enabled||!device.group_enabled)throw new HttpError(403,'设备尚未批准或授权已停用');return {device};
}
