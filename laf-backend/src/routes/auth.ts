import type { Env, User } from '../types';
import { audit, digest, hashPassword, now, publicColumns, requireUser, sessionCookie, sessionToken, validateCookieOrigin, throttle, validatePassword, verifyPassword } from '../services/auth';
import { HttpError, methodNotAllowed, readBody, requiredText, success } from '../utils/http';
export async function authRoute(request: Request, env: Env, action: string): Promise<Response> {
  if (action === 'me' && request.method === 'GET') return success(await requireUser(request, env));
  if (request.method !== 'POST') return methodNotAllowed(action === 'me' ? 'GET' : 'POST');
  if (action === 'logout') {
    validateCookieOrigin(request);
    const token = sessionToken(request) ?? '';
    const session = await env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash = ?').bind(await digest(token)).first<{user_id:number}>();
    if (session) await audit(env, session.user_id, 'auth.logout', `users/${session.user_id}`);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await digest(token)).run();
    const response = success({ loggedOut: true }); response.headers.set('Set-Cookie', sessionCookie(request, '', true)); return response;
  }
  if (action === 'password') {
    const user = await requireUser(request, env);
    const body = await readBody(request, ['oldPassword', 'password']);
    const stored = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<User>();
    if (!stored || !await verifyPassword(requiredText(body.oldPassword, 'oldPassword'), stored.password_hash)) throw new HttpError(403, '原密码错误');
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(validatePassword(body.password)), user.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
      env.DB.prepare("INSERT INTO logs (user_id, action, target) VALUES (?, 'user.password', ?)").bind(user.id, `users/${user.id}`),
    ]);
    return success({ changed: true });
  }
  if (!['register', 'login', 'bootstrap'].includes(action)) throw new HttpError(404, 'Route not found');
  const body = await readBody(request, ['username', 'password']);
  const username = requiredText(body.username, 'username').trim();
  if (!/^[\p{L}\p{N}_-]{3,40}$/u.test(username)) throw new HttpError(400, '用户名需要 3–40 个字母、数字、下划线或连字符');
  const password = validatePassword(body.password);
  if (action === 'login') {
    await throttle(env, `login:${username}`, 10);
    const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<User>();
    const valid = await verifyPassword(password, user?.password_hash ?? `pbkdf2$100000$${'0'.repeat(32)}$${'0'.repeat(64)}`);
    if (!user || !valid) throw new HttpError(401, '用户名或密码错误');
    if (user.approval_status !== 'approved') throw new HttpError(403, `账号状态：${user.approval_status}，请联系管理员`);
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now()),
      env.DB.prepare('DELETE FROM auth_throttle WHERE key = ?').bind(`login:${username}`),
      env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await digest(token), user.id, now() + 86400),
      env.DB.prepare("INSERT INTO logs (user_id, action, target) VALUES (?, 'auth.login', ?)").bind(user.id, `users/${user.id}`),
    ]);
    const { password_hash: _, ...publicUser } = user;
    const response = success({ token, user: publicUser, expiresAt: now() + 86400 });
    response.headers.set('Set-Cookie', sessionCookie(request, token)); return response;
  }
  await throttle(env, `register:${request.headers.get('CF-Connecting-IP') ?? 'local'}`, 20);
  if (action === 'bootstrap') {
    const provided = request.headers.get('X-Bootstrap-Key');
    if (!env.ADMIN_BOOTSTRAP_KEY || !provided || await digest(provided) !== await digest(env.ADMIN_BOOTSTRAP_KEY)) throw new HttpError(403, '初始化密钥无效');
    if (await env.DB.prepare("SELECT id FROM users WHERE role = 'admin' AND approval_status = 'approved'").first()) throw new HttpError(409, '管理员已初始化');
  }
  if (await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first()) throw new HttpError(409, '用户名已存在');
  const hash = await hashPassword(password);
  if (action === 'bootstrap') {
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO bootstrap_guard (id) VALUES (1)'),
        env.DB.prepare("INSERT INTO users (username, password_hash, role, approval_status) VALUES (?, ?, 'admin', 'approved')").bind(username, hash),
      ]);
    } catch { throw new HttpError(409, '初始化已完成或用户名冲突'); }
  } else {
    const result = await env.DB.prepare("INSERT INTO users (username, password_hash, role, approval_status) VALUES (?, ?, 'editor', 'pending') ON CONFLICT(username) DO NOTHING RETURNING id").bind(username, hash).first();
    if (!result) throw new HttpError(409, '用户名已存在');
  }
  const registered = await env.DB.prepare(`SELECT ${publicColumns} FROM users WHERE username = ?`).bind(username).first<User>();
  if (registered) await audit(env, registered.id, action === 'bootstrap' ? 'user.bootstrap' : 'user.register', `users/${registered.id}`);
  return success(registered, 201);
}
