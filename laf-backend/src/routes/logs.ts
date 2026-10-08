import type { Log } from '../types';
import { HttpError, methodNotAllowed, parseId, success } from '../utils/http';

export async function logsRoute(request: Request, db: D1Database): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET');
  const params = new URL(request.url).searchParams;
  const clauses: string[] = [], values: (string | number)[] = [];
  if (params.has('user_id')) { clauses.push('l.user_id=?'); values.push(parseId(params.get('user_id')!)); }
  if (params.has('action')) { const action=params.get('action')!; if(!/^[a-z]+\.[a-z]+$/.test(action))throw new HttpError(400,'无效日志操作'); clauses.push('l.action=?');values.push(action); }
  if (params.has('before')) {clauses.push('l.id<?');values.push(parseId(params.get('before')!));}
  for (const [field, operator] of [['from','>='],['to','<=']] as const) {
    if(params.has(field)) { const day=params.get(field)!; if(!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)))throw new HttpError(400,'无效日期'); clauses.push(`l.created_at ${operator} ?`);values.push(`${day} ${field==='from'?'00:00:00':'23:59:59'}`); }
  }
  const limit=Number(params.get('limit') ?? 50); if(!Number.isInteger(limit)||limit<1||limit>100)throw new HttpError(400,'每页需要 1–100 条');
  return success((await db.prepare(`SELECT l.*,u.username FROM logs l LEFT JOIN users u ON u.id=l.user_id ${clauses.length?'WHERE '+clauses.join(' AND '):''} ORDER BY l.id DESC LIMIT ?`).bind(...values,limit).all<Log>()).results);
}
