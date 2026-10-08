import {reserveUpload,releaseUpload} from '../services/quota';
import {requireReadAccess} from '../services/devices';
import type { Env } from '../types';
import { requireEditor } from '../services/auth';
import { HttpError, methodNotAllowed, success, readLimitedBody } from '../utils/http';
export async function imagesRoute(request: Request, env: Env, id?: string): Promise<Response> {
  if (id && !/^[a-f0-9-]{36}$/.test(id)) throw new HttpError(400, '无效图片 ID');
  if (request.method === 'GET' && id) {
    const access=await requireReadAccess(request,env);
    if(access.device&&!await env.DB.prepare("SELECT id FROM items WHERE image_id=? AND status='found'").bind(id).first())throw new HttpError(404,'图片不存在');
    const row = await env.DB.prepare('SELECT object_key FROM images WHERE id = ?').bind(id).first<{ object_key: string }>();
    if (!row) throw new HttpError(404, '图片不存在');
    const object = await env.IMAGES.get(row.object_key);
    if (!object) throw new HttpError(404, '图片文件不存在');
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('ETag', object.httpEtag);
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(object.body, { headers });
  }
  const user = await requireEditor(request, env);
  if (request.method === 'POST' && !id) {
    const bytes=await readLimitedBody(request,5*1024*1024),size=bytes.length;
    if(!size)throw new HttpError(400,'请选择图片');
    const signature = Array.from(bytes.slice(0, 8)).join(',');
    const type = signature === '137,80,78,71,13,10,26,10' ? 'image/png'
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
      : new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP' ? 'image/webp' : null;
    if (!type) throw new HttpError(415, '只支持 PNG、JPEG、WebP 图片');
    const imageId = await reserveUpload(env,user.id,size);
    const key = `items/${imageId}`;
    try {
      await env.IMAGES.put(key, bytes, { httpMetadata: { contentType: type } });
      const result=await env.DB.batch([
      env.DB.prepare('INSERT INTO images (id, object_key, content_type, size, uploaded_by) SELECT ?,?,?,?,? FROM upload_reservations WHERE id=? AND expires_at>unixepoch() RETURNING id').bind(imageId, key, type, size, user.id,imageId),
      env.DB.prepare("INSERT INTO logs (user_id,action,target,details) SELECT ?,'image.upload',?,? WHERE changes()=1").bind(user.id, `images/${imageId}`, JSON.stringify({content_type:type,size})),
      env.DB.prepare('DELETE FROM upload_reservations WHERE id=?').bind(imageId),
    ]);if(!result[0]!.results.length)throw new HttpError(409,'上传授权已过期，请重新上传');}
    catch (error) { await env.IMAGES.delete(key); await releaseUpload(env,imageId);throw error; }
    return success({ id: imageId, url: `/api/images/${imageId}`, size, content_type: type }, 201);
  }
  if (request.method === 'DELETE' && id) {
    const row = await env.DB.prepare('SELECT object_key, uploaded_by FROM images WHERE id = ?').bind(id).first<{ object_key: string; uploaded_by: number }>();
    if (!row) throw new HttpError(404, '图片不存在');
    if (row.uploaded_by !== user.id && user.role !== 'admin') throw new HttpError(403, '没有删除权限');
    if (await env.DB.prepare('SELECT id FROM items WHERE image_id = ?').bind(id).first()) throw new HttpError(409, '图片正在被记录引用');
    try { await env.DB.batch([
      env.DB.prepare('INSERT INTO image_deletions(id,object_key,size,user_id) SELECT id,object_key,size,uploaded_by FROM images WHERE id=?').bind(id),
      env.DB.prepare('DELETE FROM images WHERE id = ?').bind(id),
      env.DB.prepare("INSERT INTO logs (user_id,action,target) SELECT ?,'image.delete',? WHERE changes()=1").bind(user.id,`images/${id}`),
    ]); }
    catch { throw new HttpError(409, '图片正在被记录引用'); }
    await env.IMAGES.delete(row.object_key);
    await env.DB.prepare('DELETE FROM image_deletions WHERE id=?').bind(id).run();
    return success({ id });
  }
  return methodNotAllowed(id ? 'GET, DELETE' : 'POST');
}
