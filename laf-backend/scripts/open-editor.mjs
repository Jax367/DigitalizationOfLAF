import {execFile} from 'node:child_process';
const origin=new URL(process.argv[2]??process.env.LAF_EDITOR_ORIGIN??'http://127.0.0.1:8787');
if(!['http:','https:'].includes(origin.protocol))throw Error('编辑端需要 HTTP/HTTPS 服务地址');
const url=new URL('/editor/',origin).href;
const command=process.platform==='win32'?'powershell.exe':process.platform==='darwin'?'open':'xdg-open';
const args=process.platform==='win32'?['-NoProfile','-Command','Start-Process -FilePath $env:LAF_EDITOR_URL']:[url];
execFile(command,args,{env:{...process.env,LAF_EDITOR_URL:url},windowsHide:true},error=>{if(error){console.error(error.message);process.exitCode=1;}else console.log(`网页编辑端：${url}`);});
