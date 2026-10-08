import {paginateSql} from '../utils/pagination';
import type { Env, PublicUser } from '../types';
import { publicColumns, requireUser } from '../services/auth';
import { HttpError, methodNotAllowed, parseId, readBody, success } from '../utils/http';

export async function usersRoute(request: Request, env: Env, rawId?: string): Promise<Response> {
  const admin = await requireUser(request, env, true);
  if (request.method === 'GET' && rawId === undefined) return paginateSql(request,env.DB,`SELECT id AS _cursor,${publicColumns} FROM users`);
  if (request.method !== 'PATCH' || rawId === undefined) return methodNotAllowed(rawId ? 'PATCH' : 'GET');
  const id = parseId(rawId);
  const body = await readBody(request, ['approval_status', 'can_edit']);
  const status = body.approval_status;
  if (status !== undefined && !['approved', 'rejected', 'disabled'].includes(String(status))) throw new HttpError(400, '无效的审批状态');
  if (body.can_edit !== undefined && typeof body.can_edit !== 'boolean') throw new HttpError(400, 'can_edit 需要为布尔值');
  if (status === undefined && body.can_edit === undefined) throw new HttpError(400, '请指定账号状态或编辑权限');
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<PublicUser>();
  if (!user) throw new HttpError(404, '账号不存在');
  if (user.role === 'admin') throw new HttpError(403, '此接口不允许修改管理员状态');
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET approval_status = ?, can_edit = ? WHERE id = ?').bind(status ?? user.approval_status, body.can_edit === undefined ? user.can_edit : body.can_edit ? 1 : 0, id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
    env.DB.prepare('INSERT INTO logs (user_id, action, target, details) VALUES (?, ?, ?, ?)').bind(admin.id, body.can_edit === undefined ? 'user.review' : 'user.permission', `users/${id}`, JSON.stringify({before:{approval_status:user.approval_status,can_edit:user.can_edit},after:{approval_status:status ?? user.approval_status,can_edit:body.can_edit === undefined ? user.can_edit : body.can_edit ? 1 : 0}})),
  ]);
  return success(await env.DB.prepare(`SELECT ${publicColumns} FROM users WHERE id = ?`).bind(id).first());
}
