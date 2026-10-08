const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const storage = require('../src/storage.cjs');
test('只抓未认领完整记录；已认领本地记录在七天后离线清理', async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'laf-retention-'));
 try{
  const now=Date.parse('2026-10-07T00:00:00Z'), id='11111111-1111-1111-1111-111111111111';
  await storage.writeJson(path.join(root,'records.json'),{items:[{id:1,title:'杯子',status:'found',image_id:id}],syncedAt:new Date(now).toISOString()});
  await storage.writeJson(path.join(root,'images',id+'.json'),{size:3,dataUrl:'data:image/png;base64,YWJj'});
  const requested=[];
  const snapshot=await storage.syncReadOnlyCache(root,storage.defaults,async route=>{
   requested.push(route); if(route==='/api/items?status=found')return [{id:2,title:'钥匙',status:'found',image_id:null}];
   return [{id:1,status:'claimed',claimed_at:'2026-10-06 00:00:00'}];
  },async()=>{throw Error('旧图片不应再下载');},now);
  assert.deepEqual(requested,['/api/items?status=found','/api/items/cache-status?ids=1']);
  assert.equal(snapshot.items.find(item=>item.id===1).status,'claimed');
  assert.equal(snapshot.items.filter(item=>item.status==='found').length,1);
  assert.ok(await storage.imageData(root,id));
  const before=await storage.pruneRetired(root,Date.parse('2026-10-12T23:59:59Z'));assert.equal(before.items.length,2);
  const after=await storage.pruneRetired(root,Date.parse('2026-10-13T00:00:00Z'));assert.deepEqual(after.items.map(item=>item.id),[2]);assert.equal(await storage.imageData(root,id),null);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('指定记录目录必须是绝对路径，服务端过滤失败不能把已认领记录当新数据保存',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'laf-filter-'));
 try{
  assert.equal(storage.normalizeSettings({...storage.defaults,cacheDirectory:root}).cacheDirectory,path.resolve(root));
  assert.throws(()=>storage.normalizeSettings({...storage.defaults,cacheDirectory:'relative-folder'}));
  assert.throws(()=>storage.normalizeSettings({...storage.defaults,theme:'unknown'}));
  for(const transparency of [-1,101,0.5,'50'])assert.throws(()=>storage.normalizeSettings({...storage.defaults,transparency}));
  assert.equal(storage.normalizeSettings({...storage.defaults,theme:'dark',transparency:100}).transparency,100);
  await assert.rejects(storage.syncReadOnlyCache(root,storage.defaults,async()=>[{id:1,status:'claimed'}],async()=>null));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
