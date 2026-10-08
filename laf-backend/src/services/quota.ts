import type {Env} from '../types';
import {now} from './auth';
import {HttpError} from '../utils/http';
import {positiveSetting} from './security';
export async function reserveUpload(env:Env,userId:number,size:number):Promise<string>{
 const id=crypto.randomUUID(),MiB=1024*1024;
 const globalBytes=positiveSetting(env.UPLOAD_GLOBAL_MB,5120)*MiB,userBytes=positiveSetting(env.UPLOAD_USER_MB,500)*MiB,dailyBytes=positiveSetting(env.UPLOAD_DAILY_MB,100)*MiB;
 const globalCount=positiveSetting(env.UPLOAD_GLOBAL_COUNT,5000),userCount=positiveSetting(env.UPLOAD_USER_COUNT,500),dailyCount=positiveSetting(env.UPLOAD_DAILY_COUNT,100);
 const row=await env.DB.prepare(
  'INSERT INTO upload_reservations(id,user_id,size,expires_at) SELECT ?,?,?,? WHERE '+
  '(SELECT COALESCE(SUM(size),0) FROM images)+(SELECT COALESCE(SUM(size),0) FROM image_deletions)+(SELECT COALESCE(SUM(size),0) FROM upload_reservations)+?<=? AND '+
  '(SELECT COUNT(*) FROM images)+(SELECT COUNT(*) FROM image_deletions)+(SELECT COUNT(*) FROM upload_reservations)+1<=? AND '+
  '(SELECT COALESCE(SUM(size),0) FROM images WHERE uploaded_by=?)+(SELECT COALESCE(SUM(size),0) FROM image_deletions WHERE user_id=?)+(SELECT COALESCE(SUM(size),0) FROM upload_reservations WHERE user_id=?)+?<=? AND '+
  '(SELECT COUNT(*) FROM images WHERE uploaded_by=?)+(SELECT COUNT(*) FROM image_deletions WHERE user_id=?)+(SELECT COUNT(*) FROM upload_reservations WHERE user_id=?)+1<=? AND '+
  "COALESCE((SELECT bytes FROM upload_daily WHERE user_id=? AND day=date('now')),0)+?<=? AND "+
  "COALESCE((SELECT count FROM upload_daily WHERE user_id=? AND day=date('now')),0)+1<=? RETURNING id"
 ).bind(id,userId,size,now()+1800,size,globalBytes,globalCount,userId,userId,userId,size,userBytes,userId,userId,userId,userCount,userId,size,dailyBytes,userId,dailyCount).first<{id:string}>();
 if(!row)throw new HttpError(429,'上传配额已用完，请清理图片或联系管理员');return id;
}
export async function releaseUpload(env:Env,id:string){await env.DB.prepare('DELETE FROM upload_reservations WHERE id=?').bind(id).run();}
export async function cleanupResources(env:Env){
 const imageBatch=positiveSetting(env.CLEANUP_IMAGE_BATCH,10,10),rowBatch=positiveSetting(env.CLEANUP_ROW_BATCH,1000,1000);
 const rows=(await env.DB.prepare('SELECT id FROM upload_reservations WHERE expires_at<=? LIMIT ?').bind(now(),imageBatch).all<{id:string}>()).results;
 for(const row of rows){await env.IMAGES.delete('items/'+row.id);await releaseUpload(env,row.id);}
 const pending=(await env.DB.prepare('SELECT id,object_key FROM image_deletions ORDER BY created_at LIMIT ?').bind(imageBatch).all<{id:string;object_key:string}>()).results;
 for(const row of pending){await env.IMAGES.delete(row.object_key);await env.DB.prepare('DELETE FROM image_deletions WHERE id=?').bind(row.id).run();}
 await env.DB.batch([env.DB.prepare('DELETE FROM auth_throttle WHERE key IN(SELECT key FROM auth_throttle WHERE reset_at<=? LIMIT ?)').bind(now(),rowBatch),env.DB.prepare("DELETE FROM upload_daily WHERE rowid IN(SELECT rowid FROM upload_daily WHERE day<date('now','-7 days') LIMIT ?)").bind(rowBatch)]);
 if(env.LOG_RETENTION_DAYS && env.LOG_RETENTION_DAYS!=='0'){
  const days=positiveSetting(env.LOG_RETENTION_DAYS,90,3650);
  await env.DB.prepare("DELETE FROM logs WHERE id IN(SELECT id FROM logs WHERE created_at<datetime('now',?) ORDER BY id LIMIT ?)").bind('-'+days+' days',rowBatch*5).run();
 }
}
