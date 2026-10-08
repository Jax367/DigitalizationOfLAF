import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {validateProduction} from './deploy-production.mjs';
let checks=0;
const schema=new DatabaseSync(':memory:');schema.exec('PRAGMA foreign_keys=ON');for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())schema.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
const statements=schema.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all().map(r=>r.sql);schema.close();
const rates=Object.fromEntries(['ENTRY_LIMITER','READ_LIMITER','WRITE_LIMITER','AUTH_LIMITER','UPLOAD_LIMITER'].map((name,i)=>[name,{namespace_id:String(2000+i),simple:{limit:10000,period:60}}]));
const variables={ADMIN_BOOTSTRAP_KEY:'security-fixture-only',DEPLOYMENT_MODE:'production',ALLOWED_HOSTS:'laf.test',MAX_RECORDS:'200',UPLOAD_USER_COUNT:'2',UPLOAD_DAILY_COUNT:'3',UPLOAD_GLOBAL_COUNT:'3',LOG_RETENTION_DAYS:'90'};
const worker={name:'security-fixture',modules:true,scriptPath:new URL('../.test-build/index.js',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),compatibilityDate:'2026-09-01',d1Databases:['DB'],r2Buckets:['IMAGES'],ratelimits:rates,bindings:variables,};
const options={workers:[worker],host:'127.0.0.1',port:0};
const mf=new Miniflare(convertV4MiniflareOptions(options));
const reset=async options=>{await mf.setOptions(convertV4MiniflareOptions(options));db=await mf.getD1Database('DB','security-fixture');};
let db=await mf.getD1Database('DB','security-fixture');for(const sql of statements)await db.prepare(sql).run();await db.prepare("INSERT INTO access_groups(name) VALUES('测试组')").run();
let admin;
async function call(route,method='GET',body,token=admin,expected=200,extra={}){
 const response=await mf.dispatchFetch('https://laf.test'+route,{method,headers:{Connection:'close',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':body instanceof Uint8Array?'image/png':'application/json'}:{}),...extra},...(body?{body:body instanceof Uint8Array||typeof body==='string'?body:JSON.stringify(body)}:{})});const payload=await response.json();assert.equal(response.status,expected,route+': '+JSON.stringify(payload));checks++;return {data:payload.data,pagination:payload.pagination,headers:response.headers};
}
try{
 assert.equal((await mf.dispatchFetch('http://laf.test/')).status,426);assert.equal((await mf.dispatchFetch('https://another.test/')).status,403);checks+=2;
 const health=await mf.dispatchFetch('https://laf.test/');assert.equal(health.headers.get('strict-transport-security'),'max-age=31536000');checks++;
 await call('/api/auth/bootstrap','POST',{username:'security-admin',password:'Security-password-2026'},undefined,201,{'X-Bootstrap-Key':'security-fixture-only'});
 admin=(await call('/api/auth/login','POST',{username:'security-admin',password:'Security-password-2026'},undefined)).data.token;
 await call('/api/items','POST','{"title":"'+ 'x'.repeat(33000)+'","status":"found"}',admin,413);
 const hugeStream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"title":"'+'x'.repeat(33000)+'"}'));controller.close();}});
 const streamed=await mf.dispatchFetch('https://laf.test/api/items',{method:'POST',headers:{Connection:'close',Authorization:'Bearer '+admin,'Content-Type':'application/json'},body:hugeStream,duplex:'half'});assert.equal(streamed.status,413);checks++;
 const png=new Uint8Array([137,80,78,71,13,10,26,10]);
 await call('/api/images','POST',new Uint8Array(5242881),admin,413);
 const images=await Promise.all([call('/api/images','POST',png,admin,201),call('/api/images','POST',png,admin,201)]);
 await call('/api/images','POST',png,admin,429);
 await call('/api/images/'+images[0].data.id,'DELETE');await call('/api/images','POST',png,admin,201);await call('/api/images/'+images[1].data.id,'DELETE');
 await call('/api/images','POST',png,admin,429);assert.equal((await db.prepare("SELECT count FROM upload_daily WHERE user_id=1 AND day=date('now')").first()).count,3);checks++;
 // Daily usage is not refunded by deleting images; reservations count against concurrent storage quotas.
 await db.prepare('DELETE FROM upload_daily').run();await db.prepare('DELETE FROM images').run();
 await reset({...options,workers:[{...worker,bindings:{...variables,UPLOAD_USER_COUNT:'1',UPLOAD_GLOBAL_COUNT:'3'}}]});
 const concurrent=await Promise.all([1,2].map(()=>mf.dispatchFetch('https://laf.test/api/images',{method:'POST',headers:{Authorization:'Bearer '+admin,'Content-Type':'image/png'},body:png})));
 assert.deepEqual(concurrent.map(r=>r.status).sort(),[201,429]);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM images').first()).n,1);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM upload_reservations').first()).n,0);checks++;

 // A second account cannot bypass the shared global storage limit.
 await db.prepare("INSERT INTO users(username,password_hash,role,approval_status,can_edit) SELECT 'quota-editor',password_hash,'editor','approved',1 FROM users WHERE id=1").run();
 const other=(await call('/api/auth/login','POST',{username:'quota-editor',password:'Security-password-2026'},undefined)).data.token;
 await reset({...options,workers:[{...worker,bindings:{...variables,UPLOAD_GLOBAL_COUNT:'1',UPLOAD_USER_COUNT:'10'}}]});await call('/api/images','POST',png,other,429);
 const large=new Uint8Array(1048577);large.set(png);
 await reset({...options,workers:[{...worker,bindings:{...variables,UPLOAD_GLOBAL_MB:'1',UPLOAD_USER_MB:'10',UPLOAD_GLOBAL_COUNT:'10',UPLOAD_USER_COUNT:'10'}}]});await call('/api/images','POST',large,other,429);
 await reset({...options,workers:[{...worker,bindings:{...variables,UPLOAD_GLOBAL_MB:'10',UPLOAD_USER_MB:'1',UPLOAD_GLOBAL_COUNT:'10',UPLOAD_USER_COUNT:'10'}}]});await call('/api/images','POST',large,other,429);
 await reset({...options,workers:[{...worker,bindings:{...variables,UPLOAD_GLOBAL_MB:'10',UPLOAD_USER_MB:'10',UPLOAD_DAILY_MB:'1',UPLOAD_GLOBAL_COUNT:'10',UPLOAD_USER_COUNT:'10'}}]});await call('/api/images','POST',large.slice(0,1048576),other,201);await call('/api/images','POST',png,other,429);
 // Failed object deletion keeps its capacity charged until the cleanup queue finishes.
 await db.prepare('DELETE FROM images').run();await db.prepare("INSERT INTO image_deletions(id,object_key,size,user_id) VALUES('queued-delete','fixture-key',8,1)").run();
 await reset({...options,workers:[{...worker,bindings:{...variables,UPLOAD_GLOBAL_COUNT:'1',UPLOAD_USER_COUNT:'10'}}]});await call('/api/images','POST',png,other,429);await db.prepare('DELETE FROM image_deletions').run();
 await db.batch(Array.from({length:125},(_,i)=>db.prepare("INSERT INTO items(title,description,status) VALUES(?,?,'found')").bind('分页-'+String(i).padStart(3,'0'),'中文搜索说明')));
 const first=await call('/api/items?limit=100');assert.equal(first.data.length,100);assert.ok(first.pagination.nextCursor);checks++;
 const late=(await call('/api/items','POST',{title:'分页期间新增',status:'found'},admin,201)).data;
 const next=await call('/api/items?limit=100&before='+first.pagination.nextCursor+'&snapshot='+first.pagination.snapshot);assert.equal(next.data.length,25);assert.equal(next.pagination.nextCursor,null);assert.ok(!next.data.some(i=>i.id===late.id));assert.equal(new Set([...first.data,...next.data].map(i=>i.id)).size,125);checks++;
 await call('/api/items?limit=101','GET',undefined,admin,400);await call('/api/items?before=bad','GET',undefined,admin,400);assert.equal((await call('/api/items?q='+encodeURIComponent('分页-000'))).data.length,1);checks++;
 await reset({...options,workers:[{...worker,bindings:{...variables,MAX_RECORDS:'126'}}]});const before=(await db.prepare("SELECT COUNT(*) AS n FROM logs WHERE action='item.create'").first()).n;await call('/api/items','POST',{title:'超过记录上限',status:'found'},admin,429);assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM logs WHERE action='item.create'").first()).n,before);checks++;
 await reset({...options,workers:[{...worker,bindings:{...variables,ALLOWED_SOURCE_IPS:'192.0.2.10'}}]});assert.equal((await mf.dispatchFetch('https://laf.test/')).status,403);assert.equal((await mf.dispatchFetch('https://laf.test/',{headers:{'CF-Connecting-IP':'192.0.2.10'}})).status,200);checks+=2;
 await reset({...options,workers:[{...worker,ratelimits:{...rates,ENTRY_LIMITER:{namespace_id:'9999',simple:{limit:1,period:60}}}}]});assert.equal((await mf.dispatchFetch('https://laf.test/',{headers:{'CF-Connecting-IP':'192.0.2.99'}})).status,200);const limited=await mf.dispatchFetch('https://laf.test/',{headers:{'CF-Connecting-IP':'192.0.2.99'}});assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');checks++;
 const example=JSON.parse(await readFile(new URL('../wrangler.production.example.json',import.meta.url),'utf8'));assert.throws(()=>validateProduction(example));const valid={...example,account_id:'a'.repeat(32),routes:[{pattern:'laf.school.test',custom_domain:true,previews_enabled:false}],vars:{...example.vars,ALLOWED_HOSTS:'laf.school.test'},d1_databases:[{...example.d1_databases[0],database_id:'11111111-1111-1111-1111-111111111111'}]};assert.deepEqual(validateProduction(valid),['laf.school.test']);assert.throws(()=>validateProduction({...valid,workers_dev:true}));checks++;
 assert.throws(()=>validateProduction({...valid,limits:{cpu_ms:50}}),/免费套餐/);
 assert.deepEqual(validateProduction({...valid,vars:{...valid.vars,WORKERS_PLAN:'paid'},limits:{cpu_ms:50}}),['laf.school.test']);
 assert.throws(()=>validateProduction({...valid,vars:{...valid.vars,WORKERS_PLAN:'paid'}}),/CPU/);
 assert.throws(()=>validateProduction({...valid,vars:{...valid.vars,WORKERS_PLAN:'unknown'}}),/WORKERS_PLAN/);
 assert.throws(()=>validateProduction({...valid,vars:{...valid.vars,CLEANUP_IMAGE_BATCH:'11'}}),/清理/);
 assert.throws(()=>validateProduction({...valid,vars:{...valid.vars,CLEANUP_ROW_BATCH:'0'}}),/清理/);
 checks+=6;
 const freeAddress={...valid,workers_dev:true,routes:[],vars:{...valid.vars,ALLOWED_HOSTS:'laf-production.school-laf.workers.dev'}};
 assert.deepEqual(validateProduction(freeAddress),['laf-production.school-laf.workers.dev']);
 assert.throws(()=>validateProduction({...freeAddress,preview_urls:true}));
 assert.throws(()=>validateProduction({...freeAddress,vars:{...freeAddress.vars,ALLOWED_HOSTS:'other.school-laf.workers.dev'}}));
 assert.throws(()=>validateProduction({...freeAddress,vars:{...freeAddress.vars,ALLOWED_HOSTS:'laf-production.school-laf.workers.dev,other.school-laf.workers.dev'}}));
 assert.throws(()=>validateProduction({...freeAddress,vars:{...freeAddress.vars,ALLOWED_HOSTS:'school-laf.workers.dev'}}));
 assert.throws(()=>validateProduction({...freeAddress,routes:valid.routes}));checks+=6;
 // The scheduled handler must drain only its batch and preserve live reservations/data.
 await reset({...options,workers:[{...worker,bindings:{...variables,CLEANUP_IMAGE_BATCH:'2',CLEANUP_ROW_BATCH:'2'}}]});
 await db.prepare('DELETE FROM upload_reservations').run();await db.prepare('DELETE FROM image_deletions').run();await db.prepare('DELETE FROM auth_throttle').run();await db.prepare('DELETE FROM upload_daily').run();await db.prepare('DELETE FROM logs').run();
 await db.batch(Array.from({length:5},(_,i)=>db.prepare('INSERT INTO upload_reservations(id,user_id,size,expires_at) VALUES(?,1,8,0)').bind('expired-'+i)));
 await db.prepare("INSERT INTO upload_reservations(id,user_id,size,expires_at) VALUES('live',1,8,9999999999)").run();
 await db.batch(Array.from({length:5},(_,i)=>db.prepare('INSERT INTO image_deletions(id,object_key,size,user_id) VALUES(?,?,8,1)').bind('delete-'+i,'items/delete-'+i)));
 await db.batch(Array.from({length:5},(_,i)=>db.prepare('INSERT INTO auth_throttle(key,count,reset_at) VALUES(?,1,0)').bind('expired-'+i)));
 await db.prepare("INSERT INTO auth_throttle(key,count,reset_at) VALUES('live',1,9999999999)").run();
 await db.prepare('DELETE FROM upload_daily').run();
 await db.batch(Array.from({length:5},(_,i)=>db.prepare("INSERT INTO upload_daily(user_id,day,count,bytes) VALUES(1,?,1,8)").bind('2000-01-0'+(i+1))));
 await db.prepare("INSERT INTO upload_daily(user_id,day,count,bytes) VALUES(1,date('now'),1,8)").run();
 await db.batch(Array.from({length:12},()=>db.prepare("INSERT INTO logs(user_id,action,created_at) VALUES(1,'old','2000-01-01')")));
 await db.prepare("INSERT INTO logs(user_id,action) VALUES(1,'live')").run();
 const scheduled=await (await mf.getWorker('security-fixture')).scheduled({cron:'0 * * * *'});assert.equal(scheduled.outcome,'ok');
 for(const [table,count] of [['upload_reservations',4],['image_deletions',3],['auth_throttle',4],['upload_daily',4],['logs',3]])assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n,count);
 assert.ok(await db.prepare("SELECT id FROM upload_reservations WHERE id='live'").first());assert.ok(await db.prepare("SELECT key FROM auth_throttle WHERE key='live'").first());assert.ok(await db.prepare("SELECT day FROM upload_daily WHERE day=date('now')").first());assert.ok(await db.prepare("SELECT id FROM logs WHERE action='live'").first());checks++;
 console.log(checks+' 项隔离安全检查通过：HTTPS入口、来源限制、请求流大小、分页快照、并发配额、日预算、限流、免费部署校验和分批清理');
}finally{await mf.dispose();}
