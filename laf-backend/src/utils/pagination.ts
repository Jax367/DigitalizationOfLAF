import {HttpError,parseId} from './http';
export function pageOptions(request:Request){const p=new URL(request.url).searchParams,limit=Number(p.get('limit')??50);if(!Number.isInteger(limit)||limit<1||limit>100)throw new HttpError(400,'每页需要 1–100 条');const before=p.has('before')?parseId(p.get('before')!):null,snapshot=p.has('snapshot')?Number(p.get('snapshot')):null;if(snapshot!==null&&(!Number.isSafeInteger(snapshot)||snapshot<0))throw new HttpError(400,'无效列表快照');return {limit,before,snapshot};}
export function pageResponse<T>(items:T[],limit:number,snapshot:number,key:(row:T)=>number){const more=items.length>limit,data=items.slice(0,limit);return Response.json({success:true,data,pagination:{limit,snapshot,nextCursor:more?key(data.at(-1)!):null}},{headers:{'Cache-Control':'no-store'}});}

export async function paginateSql(request:Request,db:D1Database,sql:string,bindings:(string|number|null)[]=[]):Promise<Response>{
 const p=pageOptions(request),snapshot=p.snapshot??(await db.prepare('SELECT COALESCE(MAX(_cursor),0) AS value FROM ('+sql+')').bind(...bindings).first<{value:number}>())!.value;
 const values:number[]=[snapshot];if(p.before)values.push(p.before);values.push(p.limit+1);
 const rows=(await db.prepare('SELECT * FROM ('+sql+') WHERE _cursor<=?'+(p.before?' AND _cursor<?':'')+' ORDER BY _cursor DESC LIMIT ?').bind(...bindings,...values).all<{_cursor:number;[key:string]:unknown}>()).results;
 const more=rows.length>p.limit,selected=rows.slice(0,p.limit),data=selected.map(({_cursor,...row})=>row);
 return Response.json({success:true,data,pagination:{limit:p.limit,snapshot,nextCursor:more?selected.at(-1)!._cursor:null}},{headers:{'Cache-Control':'no-store'}});
}
