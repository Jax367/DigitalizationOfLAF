import {pageOptions,pageResponse} from '../utils/pagination';
import {positiveSetting} from '../services/security';
import {requireReadAccess} from '../services/devices';
import type { Env, Item } from '../types';
import { audit, requireEditor, requireUser, sessionToken } from '../services/auth';
import { HttpError, methodNotAllowed, nullableText, parseId, readBody, requiredText, success } from '../utils/http';

const fields = ['title', 'description', 'floor', 'image_id', 'status'] as const;
type Field = typeof fields[number];
function validate(field: Field, value: unknown): string | number | null {
  if (field === 'title') {
    const title = requiredText(value, field).trim();
    if (title.length > 200) throw new HttpError(400, '物品名称不能超过 200 个字符');
    return title;
  }
  if (field === 'status') {
    if (value !== 'found' && value !== 'claimed') throw new HttpError(400, 'status must be found or claimed');
    return value;
  }
  if (field === 'image_id' && value !== null && (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value))) throw new HttpError(400, '无效图片引用');
  if (typeof value === 'string' && value.length > (field === 'description' ? 5000 : 200)) throw new HttpError(400, `${field} 过长`);
  return nullableText(value, field);
}
export async function itemsRoute(request: Request, env: Env, rawId?: string): Promise<Response> {
  const db = env.DB;
  const id = rawId === undefined ? undefined : parseId(rawId);
  if (request.method === 'GET') {
    const access=await requireReadAccess(request,env);
    if (id === undefined) {
      const requestedStatus = new URL(request.url).searchParams.get('status');
      if(access.device && requestedStatus && requestedStatus!=='found')throw new HttpError(403,'只读设备只允许获取未认领记录');
      const status=access.device?'found':requestedStatus;
      if (status && status !== 'found' && status !== 'claimed') throw new HttpError(400, '无效认领状态');

      const p=pageOptions(request),snapshot=p.snapshot??(await db.prepare('SELECT COALESCE(MAX(id),0) AS value FROM items').first<{value:number}>())!.value;
      const clauses=['id<=?'],values:(string|number)[]=[snapshot];if(p.before){clauses.push('id<?');values.push(p.before);}if(status){clauses.push('status=?');values.push(status);}
      const q=new URL(request.url).searchParams.get('q')?.trim();if(q){if(q.length>200)throw new HttpError(400,'搜索内容过长');clauses.push("(instr(lower(title),lower(?))>0 OR instr(lower(COALESCE(description,'')),lower(?))>0 OR instr(lower(COALESCE(floor,'')),lower(?))>0)");values.push(q,q,q);}
      const items=(await db.prepare('SELECT * FROM items WHERE '+clauses.join(' AND ')+' ORDER BY id DESC LIMIT ?').bind(...values,p.limit+1).all<Item>()).results;
      if(access.user)await audit(env,access.user.id,'item.list','items',{status:status??'all',limit:p.limit});
      return pageResponse(items,p.limit,snapshot,row=>row.id);
    }
    const item = await db.prepare('SELECT * FROM items WHERE id = ?').bind(id).first<Item>();
    if (!item || access.device && item.status!=='found') throw new HttpError(404, 'Item not found');
    if (sessionToken(request)) { const user = await requireUser(request, env); await audit(env,user.id,'item.read',`items/${id}`); }
    return success(item);
  }
  const user = await requireEditor(request, env);
  if ((request.method === 'POST' && id === undefined) || (request.method === 'PUT' && id !== undefined)) {
    if(id !== undefined && !await db.prepare('SELECT id FROM items WHERE id=?').bind(id).first())throw new HttpError(404,'Item not found');
    const body = await readBody(request, fields);
    if (id === undefined) {
      requiredText(body.title, 'title');
      validate('status', body.status);
    }
    const keys = fields.filter(key => Object.hasOwn(body, key));
    if (!keys.length) throw new HttpError(400, 'At least one editable field is required');
    const values = keys.map(key => validate(key, body[key]));
    if (body.image_id !== undefined && body.image_id !== null) {
      const image = await db.prepare('SELECT id FROM images WHERE id = ?').bind(body.image_id).first();
      if (!image) throw new HttpError(400, '图片引用不存在，请重新上传');
    }
    // Column names come exclusively from the fixed allowlist; all values are bound.
    const statement = id === undefined
      ? db.prepare(`INSERT INTO items (${keys.join(', ')}) SELECT ${keys.map(() => '?').join(', ')} WHERE (SELECT COUNT(*) FROM items)<? RETURNING *`).bind(...values,positiveSetting(env.MAX_RECORDS,10000,100000))
      : db.prepare(`UPDATE items SET ${keys.map(key => `${key} = ?`).join(', ')} WHERE id = ? RETURNING *`).bind(...values, id);
    const recordJson = "json_object('id',id,'title',title,'description',description,'floor',floor,'created_at',created_at,'status',status,'image_id',image_id)";
    const results = id === undefined ? await db.batch([
      statement,
      db.prepare(`INSERT INTO logs (user_id,action,target,details) SELECT ?, 'item.create', 'items/' || id, json_object('after',${recordJson}) FROM items WHERE id=last_insert_rowid() AND changes()=1`).bind(user.id),
    ]) : await db.batch([
      db.prepare(`INSERT INTO logs (user_id,action,target,details) SELECT ?, 'item.update', ?, json_object('before',${recordJson}) FROM items WHERE id=?`).bind(user.id,`items/${id}`,id),
      statement,
      db.prepare(`UPDATE logs SET details=json_set(details,'$.after',json((SELECT ${recordJson} FROM items WHERE id=?))) WHERE id=last_insert_rowid() AND action='item.update' AND target=?`).bind(id,`items/${id}`),
    ]);
    const item = results[id === undefined ? 0 : 1]?.results[0] as Item | undefined;
    if (!item) throw new HttpError(id===undefined?429:404,id===undefined?'记录数量已达到上限':'Item not found');
    return success(item, id === undefined ? 201 : 200);
  }
  if (request.method === 'DELETE' && id !== undefined) {
    const result = await db.batch([
      db.prepare("INSERT INTO logs (user_id,action,target,details) SELECT ?, 'item.delete', ?, json_object('before',json_object('id',id,'title',title,'description',description,'floor',floor,'created_at',created_at,'status',status,'image_id',image_id)) FROM items WHERE id=?").bind(user.id,`items/${id}`,id),
      db.prepare('DELETE FROM items WHERE id = ? RETURNING id').bind(id),
    ]);
    const deleted = result[1]?.results[0];
    if (!deleted) throw new HttpError(404, 'Item not found');
    return success(deleted);
  }
  return methodNotAllowed(id === undefined ? 'GET, POST' : 'GET, PUT, DELETE');
}
export async function cacheStatusRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET');
  await requireReadAccess(request,env);
  const text = new URL(request.url).searchParams.get('ids') ?? '';
  const parts = text.split(',');
  if (parts.length > 100 || !text) throw new HttpError(400, '需要 1–100 个序号');
  const ids = [...new Set(parts.map(parseId))];
  const rows = (await env.DB.prepare(`SELECT i.id, i.status, c.claimed_at FROM items i LEFT JOIN item_claims c ON c.item_id = i.id WHERE i.id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{id: number; status: string; claimed_at: string | null}>()).results;
  const byId = new Map(rows.map(row => [row.id, row]));
  return success(ids.map(id => byId.get(id) ?? { id, status: 'deleted', claimed_at: null }));
}
