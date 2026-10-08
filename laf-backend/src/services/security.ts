import type {Env} from '../types';
import {digest,sessionToken} from './auth';
import {HttpError} from '../utils/http';
export function positiveSetting(value:string|undefined,fallback:number,max=Number.MAX_SAFE_INTEGER):number{if(value===undefined)return fallback;const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>max)throw new HttpError(503,'安全配置无效');return n;}
export function enforceEntry(request:Request,env:Env):void{
 if(env.DEPLOYMENT_MODE!=='production')return;
 const url=new URL(request.url),hosts=(env.ALLOWED_HOSTS??'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
 if(!hosts.length||hosts.some(h=>h.includes('change_me')||h.endsWith('.invalid')))throw new HttpError(503,'正式入口尚未配置');
 if(!hosts.includes(url.hostname.toLowerCase()))throw new HttpError(403,'不允许的服务入口');
 if(url.protocol!=='https:')throw new HttpError(426,'正式服务必须使用 HTTPS');
 const allowed=(env.ALLOWED_SOURCE_IPS??'').split(',').map(s=>s.trim()).filter(Boolean);
 if(allowed.length&&!allowed.includes(request.headers.get('CF-Connecting-IP')??''))throw new HttpError(403,'来源地址不允许');
}
export async function enforceFrequency(request:Request,env:Env):Promise<void>{
 const ip=request.headers.get('CF-Connecting-IP')??'local';
 async function check(binding:RateLimit|undefined,key:string){if(!binding){if(env.DEPLOYMENT_MODE==='production')throw new HttpError(503,'限流服务未配置');return;}if(!(await binding.limit({key:await digest(key)})).success)throw new HttpError(429,'请求过于频繁，请稍后重试');}
 await check(env.ENTRY_LIMITER,'ip:'+ip);
 const path=new URL(request.url).pathname;
 if(!path.startsWith('/api/'))return;
 const credential=sessionToken(request)??request.headers.get('X-Device-Token');
 if(credential)await check(env.READ_LIMITER,'credential:'+credential);
 if(!['GET','HEAD'].includes(request.method))await check(env.WRITE_LIMITER,credential?'write:'+credential:'write-ip:'+ip);
 if(path.startsWith('/api/auth/')&&request.method==='POST'||path==='/api/device/apply')await check(env.AUTH_LIMITER,'auth:'+ip);
 if(path==='/api/images'&&request.method==='POST')await check(env.UPLOAD_LIMITER,'upload:'+(credential??ip));
}
export function secureResponse(request:Request,env:Env,response:Response):Response{
 const headers=new Headers(response.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','same-origin');
 if(env.DEPLOYMENT_MODE==='production'&&new URL(request.url).protocol==='https:')headers.set('Strict-Transport-Security','max-age=31536000');
 if(response.status===429)headers.set('Retry-After','60');return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
