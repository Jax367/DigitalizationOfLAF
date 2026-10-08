import type { Env, PublicUser } from '../types';
import { HttpError } from '../utils/http';
export const publicColumns = 'id, username, role, approval_status, can_edit, created_at';
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
export const now = () => Math.floor(Date.now() / 1000);
export async function digest(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
export function validatePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) throw new HttpError(400, '密码需要 10–128 个字符');
  return value;
}
async function derive(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256)));
}
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$100000$${hex(salt)}$${await derive(password, salt)}`;
}
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const parts = hash.split('$');
  if (parts[0] !== 'pbkdf2' || parts[1] !== '100000' || !/^[a-f0-9]{32}$/.test(parts[2] ?? '') || !/^[a-f0-9]{64}$/.test(parts[3] ?? '')) return false;
  const salt = Uint8Array.from(parts[2]!.match(/../g)!, b => parseInt(b, 16));
  const actual = await derive(password, salt);
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual.charCodeAt(i) ^ parts[3]!.charCodeAt(i);
  return difference === 0;
}
export function sessionToken(request: Request): string | undefined {
  return request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]
    ?? request.headers.get('Cookie')?.match(/(?:^|;\s*)laf_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}
export function sessionCookie(request: Request, token: string, clear = false): string {
  return `laf_session=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 86400}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export function validateCookieOrigin(request: Request): void {
  if (!['GET', 'HEAD'].includes(request.method) && !request.headers.has('Authorization') && sessionToken(request)
    && request.headers.get('Origin') !== new URL(request.url).origin) throw new HttpError(403, '网页操作来源无效');
}
export async function requireUser(request: Request, env: Env, admin = false): Promise<PublicUser> {
  validateCookieOrigin(request);
  const token = sessionToken(request);
  if (!token) throw new HttpError(401, '请先登录');
  const user = await env.DB.prepare(`SELECT ${publicColumns.split(', ').map(c => `u.${c}`).join(', ')} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`)
    .bind(await digest(token), now()).first<PublicUser>();
  if (!user) throw new HttpError(401, '登录已过期，请重新登录');
  if (user.approval_status !== 'approved') throw new HttpError(403, '账号尚未批准或已停用');
  if (admin && user.role !== 'admin') throw new HttpError(403, '需要管理员权限');
  return user;
}
export async function requireEditor(request: Request, env: Env): Promise<PublicUser> {
  const user = await requireUser(request, env);
  if (user.role !== 'admin' && user.can_edit !== 1) {
    await audit(env, user.id, 'access.denied', new URL(request.url).pathname, {method:request.method,reason:'edit_permission_revoked'});
    throw new HttpError(403, '编辑权限已被管理员撤销');
  }
  return user;
}
export async function audit(env: Env, userId: number, action: string, target: string, details: unknown = null): Promise<void> {
  await env.DB.prepare('INSERT INTO logs (user_id, action, target, details) VALUES (?, ?, ?, ?)').bind(userId, action, target, details === null ? null : JSON.stringify(details)).run();
}
export async function throttle(env: Env, key: string, limit: number): Promise<void> {
  const result = await env.DB.prepare(`INSERT INTO auth_throttle (key, count, reset_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN reset_at <= ? THEN 1 ELSE count + 1 END,
    reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END RETURNING count`)
    .bind(key, now() + 900, now(), now()).first<{ count: number }>();
  if (result && result.count > limit) throw new HttpError(429, '尝试次数过多，请 15 分钟后重试');
}
