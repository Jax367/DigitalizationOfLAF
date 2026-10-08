import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {isIP} from 'node:net';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export function validateProduction(config){
 if(typeof config.workers_dev!=='boolean'||config.preview_urls!==false)throw Error('必须明确配置 workers_dev，并关闭预览地址');
 if(!config.account_id||!/^[a-f0-9]{32}$/.test(config.account_id))throw Error('请填入真实 Cloudflare account_id');
 if(config.vars?.DEPLOYMENT_MODE!=='production')throw Error('必须启用 production 安全策略');
 const hosts=(config.vars.ALLOWED_HOSTS??'').split(',').map(s=>s.trim());
 if(!hosts.length||hosts.some(h=>!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(h)||h.endsWith('.invalid')||h.includes('example.')))throw Error('请填入真实的 HTTPS 入口域名');
 if(config.workers_dev){
  const suffix=hosts[0]?.split('.');
  if(hosts.length!==1||suffix.length!==4||suffix[0]!==config.name||suffix[2]!=='workers'||suffix[3]!=='dev'||!suffix[1]||config.routes?.length)throw Error('免费地址必须为 Worker名称.账号子域名.workers.dev，且不能同时设置 routes');
 }else if(!config.routes?.length||config.routes.some(r=>r.custom_domain!==true||r.previews_enabled!==false||!hosts.includes(r.pattern))||hosts.some(h=>!config.routes.some(r=>r.pattern===h)))throw Error('自定义域名和允许入口必须一致');
 const db=config.d1_databases?.find(b=>b.binding==='DB');if(!db||!/^[a-f0-9-]{36}$/.test(db.database_id)||db.database_id==='00000000-0000-0000-0000-000000000000')throw Error('请填入真实 D1 database_id');
 if(!config.r2_buckets?.some(b=>b.binding==='IMAGES'&&b.bucket_name))throw Error('缺少正式图片桶');
 for(const name of ['ENTRY_LIMITER','READ_LIMITER','WRITE_LIMITER','AUTH_LIMITER','UPLOAD_LIMITER']){const b=config.ratelimits?.find(b=>b.name===name);if(!b||!Number.isInteger(b.simple?.limit)||b.simple.limit<1||b.simple.period!==60)throw Error('缺少有效限流配置：'+name);}
 const plan=config.vars.WORKERS_PLAN??'free';
 if(!['free','paid'].includes(plan))throw Error('WORKERS_PLAN 必须为 free 或 paid');
 if(plan==='free'&&config.limits!==undefined)throw Error('免费套餐请移除整个 limits 配置；平台自动执行 10ms CPU 上限');
 if(plan==='paid'&&(!Number.isInteger(config.limits?.cpu_ms)||config.limits.cpu_ms<1||config.limits.cpu_ms>100))throw Error('付费配置需要不超过 100ms 的 CPU 上限');
 for(const [key,max] of [['CLEANUP_IMAGE_BATCH',10],['CLEANUP_ROW_BATCH',1000]]){if(config.vars[key]!==undefined){const n=Number(config.vars[key]);if(!Number.isInteger(n)||n<1||n>max)throw Error('无效清理批量：'+key);}}
 for(const key of ['UPLOAD_GLOBAL_MB','UPLOAD_USER_MB','UPLOAD_DAILY_MB','UPLOAD_GLOBAL_COUNT','UPLOAD_USER_COUNT','UPLOAD_DAILY_COUNT','MAX_RECORDS']){const value=Number(config.vars[key]);if(!Number.isSafeInteger(value)||value<1||value>100000)throw Error('无效容量配置：'+key);}
 const retention=Number(config.vars.LOG_RETENTION_DAYS??0);if(!Number.isInteger(retention)||retention<0||retention>3650)throw Error('日志留存天数无效');
 if((config.vars.ALLOWED_SOURCE_IPS??'').split(',').map(s=>s.trim()).filter(Boolean).some(ip=>!isIP(ip)))throw Error('来源白名单仅支持准确 IP 地址，网段规则请在 Cloudflare 配置');
 if(config.vars.ADMIN_BOOTSTRAP_KEY)throw Error('初始化密钥必须存为 Cloudflare secret，不能放入配置文件');
 return hosts;
}
async function run(args){await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'node_modules/wrangler/bin/wrangler.js'),...args],{cwd:root,stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false',XDG_CONFIG_HOME:path.join(root,'.wrangler/config'),WRANGLER_LOG_PATH:path.join(root,'.wrangler/logs/deploy.log')}});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('部署命令失败：'+code)));});}
async function main(){const args=process.argv.slice(2),at=args.indexOf('--config'),file=path.resolve(root,at>=0?args[at+1]:'wrangler.production.json');const config=JSON.parse(await readFile(file,'utf8').catch(()=>{throw Error('请复制自定义域名或 workers-dev 正式示例为 wrangler.production.json，并填写入口及资源信息');}));const hosts=validateProduction(config);console.log('正式 HTTPS 配置检查通过：'+hosts.join(', '));if((config.vars.WORKERS_PLAN??'free')==='free')console.log('免费套餐配置：未设置自定义 CPU 上限；云端仍需验证 10ms CPU 和每日额度。此标记不会变更 Cloudflare 账号套餐，R2 超额仍可能收费。');if(args.includes('--check'))return;
 // Dry-run validates bindings and bundles before changing the remote database.
 await run(['deploy','--config',file,'--dry-run']);
 await run(['d1','migrations','apply',config.d1_databases.find(b=>b.binding==='DB').database_name,'--remote','--config',file]);
 await run(['deploy','--config',file]);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
