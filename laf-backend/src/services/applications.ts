import type {Env} from '../types';
import {HttpError,success} from '../utils/http';
export async function reviewApplication(env:Env,id:number,status:string,adminId:number){
 const row=await env.DB.prepare("UPDATE device_applications SET status=?,reviewed_at=CURRENT_TIMESTAMP,reviewed_by=? WHERE id=? AND status='pending' AND expires_at>CURRENT_TIMESTAMP AND EXISTS(SELECT 1 FROM reader_devices d JOIN reader_accounts a ON a.id=d.account_id JOIN access_groups g ON g.id=a.group_id WHERE d.id=device_applications.device_id AND d.account_id=device_applications.account_id AND d.status='pending' AND a.enabled=1 AND g.enabled=1) RETURNING id,device_id,status").bind(status,adminId,id).first();
 if(!row)throw new HttpError(409,'申请已处理、已过期或账号/组已停用，请刷新列表');return success(row);
}
