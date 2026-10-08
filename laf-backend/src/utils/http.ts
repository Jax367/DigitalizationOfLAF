export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const success = (data: unknown, status = 200): Response =>
  Response.json({ success: true, data }, { status, headers: {'Cache-Control':'no-store'} });
export const failure = (error: string, status: number): Response =>
  Response.json({ success: false, error }, { status, headers: {'Cache-Control':'no-store'} });
export function methodNotAllowed(allow: string): Response {
  const response = failure('Method not allowed', 405);
  response.headers.set('Allow', allow);
  return response;
}
export function parseId(value: string): number {
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id)) {
    throw new HttpError(400, 'id must be a positive safe integer');
  }
  return id;
}
export async function readBody(request: Request, allowed: readonly string[]): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  const bytes=await readLimitedBody(request,32768);let body:unknown;
  try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));}catch{throw new HttpError(400,'Invalid JSON body');}
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Body must be a JSON object');
  const result = body as Record<string, unknown>;
  if (Object.keys(result).some(key => !allowed.includes(key))) throw new HttpError(400, 'Unknown field in request body');
  return result;
}
export function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${field} must be a non-empty string`);
  return value;
}
export function nullableText(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be a string or null`);
  return value;
}

export async function readLimitedBody(request:Request,max:number):Promise<Uint8Array>{
 const length=request.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>max))throw new HttpError(413,'请求内容超过允许大小');
 const reader=request.body?.getReader();if(!reader)return new Uint8Array();let size=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new HttpError(413,'请求内容超过允许大小');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
