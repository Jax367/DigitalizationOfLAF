import {enforceEntry,enforceFrequency,secureResponse} from './services/security';
import {cleanupResources} from './services/quota';
import {devicesRoute} from './routes/devices';
import type { Env } from './types';
import { itemsRoute, cacheStatusRoute } from './routes/items';
import { usersRoute } from './routes/users';
import { logsRoute } from './routes/logs';
import { authRoute } from './routes/auth';
import { imagesRoute } from './routes/images';
import { requireUser } from './services/auth';
import { failure, HttpError, methodNotAllowed } from './utils/http';

async function dispatch(request: Request, env: Env): Promise<Response> {
    try {
      enforceEntry(request,env);await enforceFrequency(request,env);
      const length=request.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>(new URL(request.url).pathname==='/api/images'?5242880:32768)))throw new HttpError(413,'请求内容超过允许大小');
      if(request.url.length>2048)throw new HttpError(414,'请求地址过长');
      const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
      if (path === '/') return request.method === 'GET'
        ? Response.json({ status: 'LAF API running' }) : methodNotAllowed('GET');
      if (path === '/editor' || path.startsWith('/editor/')) {
        const url = new URL(request.url); if(path === '/editor' || path === '/editor/') url.pathname='/editor/index.html';
        const response=await env.ASSETS.fetch(new Request(url,request));
        const headers=new Headers(response.headers);
        headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','same-origin');
        return new Response(response.body,{status:response.status,headers});
      }
      if(/^\/api\/(?:device(?:\/|$)|devices(?:\/|$)|device-applications(?:\/|$)|reader-accounts(?:\/|$)|access-groups(?:\/|$))/.test(path))return await devicesRoute(request,env,path);
      if (path === '/api/items/cache-status') return await cacheStatusRoute(request, env);
      const itemMatch = /^\/api\/items(?:\/([^/]+))?$/.exec(path);
      if (itemMatch) return await itemsRoute(request, env, itemMatch[1]);
      const authMatch = /^\/api\/auth\/([a-z]+)$/.exec(path);
      if (authMatch) return await authRoute(request, env, authMatch[1]!);
      const imageMatch = /^\/api\/images(?:\/([^/]+))?$/.exec(path);
      if (imageMatch) return await imagesRoute(request, env, imageMatch[1]);
      const userMatch = /^\/api\/users(?:\/([^/]+))?$/.exec(path);
      if (userMatch) return await usersRoute(request, env, userMatch[1]);
      if (path === '/api/logs') { await requireUser(request, env, true); return await logsRoute(request, env.DB); }
      return failure('Route not found', 404);
    } catch (error) {
      if (error instanceof HttpError) return failure(error.message, error.status);
      console.error('Unhandled API error', error);
      return failure('Internal server error', 500);
    }
}
export default {
 async fetch(request:Request,env:Env){return secureResponse(request,env,await dispatch(request,env));},
 scheduled(_controller:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(cleanupResources(env));},
} satisfies ExportedHandler<Env>;
