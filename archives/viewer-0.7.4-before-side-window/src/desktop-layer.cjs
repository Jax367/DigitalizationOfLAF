const {spawn}=require('node:child_process');
const path=require('node:path');
module.exports=window=>{
 let child=null,enabled=true,hidden=false,failed=false;
 const notify=()=>{if(child?.stdin.writable)child.stdin.write(enabled&&!hidden?'desktop\n':'pause\n');};
 const stop=()=>{if(child){child.stdin.end('quit\n');child.kill();child=null;}};
 if(process.platform==='win32'){
  const handle=window.getNativeWindowHandle();
  const hwnd=handle.length===8?handle.readBigUInt64LE().toString():String(handle.readUInt32LE());
  const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const script=path.join(__dirname,'desktop-layer.ps1').replace(/([\\/])app\.asar([\\/])/,'$1app.asar.unpacked$2');
  child=spawn(powershell,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-WindowHandle',hwnd],{windowsHide:true,stdio:['pipe','ignore','pipe']});
  child.stdin.on('error',()=>{});
  child.on('error',error=>{failed=true;console.error('Desktop layer unavailable:',error.message);});
  child.stderr.on('data',data=>{failed=true;console.error('Desktop layer:',data.toString().trim());});
  child.on('exit',code=>{if(code)failed=true;child=null;});
 }
 window.on('closed',stop);
 return {
  update(on){enabled=on;notify();},
  hidden(on){hidden=on;notify();},
  available:()=>!failed,
  stop,
 };
};
