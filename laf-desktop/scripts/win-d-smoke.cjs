const {app,BrowserWindow,safeStorage}=require('electron');
const fs=require('node:fs/promises'),storage=require('../src/storage.cjs'),{createHash}=require('node:crypto');
const path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
process.env.LAF_TEST_PROFILE=path.resolve(__dirname,'../test-output/win-d-'+Date.now());
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const handle=w=>{const b=w.getNativeWindowHandle();return b.length===8?b.readBigUInt64LE().toString():String(b.readUInt32LE());};
const definitions=`Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class LafDesktopProbe{[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetClassName(IntPtr h,System.Text.StringBuilder b,int n);[DllImport("user32.dll")]public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);[DllImport("user32.dll")]public static extern bool IsIconic(IntPtr h);[DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);[DllImport("user32.dll")]public static extern int GetWindowLong(IntPtr h,int index);[DllImport("dwmapi.dll")]public static extern int DwmGetWindowAttribute(IntPtr h,int attr,out int value,int size);public static void Focus(IntPtr h){keybd_event(18,0,0,UIntPtr.Zero);keybd_event(18,0,2,UIntPtr.Zero);SetForegroundWindow(h);}public static void Toggle(){keybd_event(91,0,0,UIntPtr.Zero);keybd_event(68,0,0,UIntPtr.Zero);keybd_event(68,0,2,UIntPtr.Zero);keybd_event(91,0,2,UIntPtr.Zero);}}';`;
const native=command=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',definitions+command],{windowsHide:true,encoding:'utf8'}).trim();
let desktopShown=false;
(async()=>{
 await storage.writeJson(path.join(process.env.LAF_TEST_PROFILE,'settings.json'),{...storage.defaults,serverUrl:'http://127.0.0.1:1'});await storage.writeJson(path.join(storage.cacheDirectory(process.env.LAF_TEST_PROFILE,'http://127.0.0.1:1'),'records.json'),{items:[{id:900,title:'Windows+D 侧窗验证',description:'',floor:'',status:'found',created_at:'2026-10-07 00:00:00',image_id:null}],syncedAt:new Date().toISOString()});
 await app.whenReady();await storage.writeJson(path.join(process.env.LAF_TEST_PROFILE,'devices',createHash('sha256').update('http://127.0.0.1:1').digest('hex')+'.json'),{encryptedToken:safeStorage.encryptString('a'.repeat(64)).toString('base64'),status:'approved',account_enabled:1,group_enabled:1});require(path.resolve(__dirname,'../../laf-viewer/src/main.cjs'));
 for(let i=0;i<100&&!BrowserWindow.getAllWindows().length;i++)await delay(100);
 const win=BrowserWindow.getAllWindows()[0];assert.ok(win);
 await delay(3000);win.showInactive();
 const firstCover=new BrowserWindow({width:460,height:400});firstCover.show();firstCover.focus();native(`[LafDesktopProbe]::Focus([IntPtr]([long]${handle(firstCover)}))`);await delay(500);assert.equal(native('[LafDesktopProbe]::GetForegroundWindow().ToInt64()'),handle(firstCover));
 native('[LafDesktopProbe]::Toggle()');desktopShown=true;await delay(500);assert.equal(native(`([LafDesktopProbe]::GetWindowLong([IntPtr]([long]${handle(win)}),-20) -band 8) -ne 0`),'True');
 win.focus();await win.webContents.executeJavaScript('document.querySelector("[data-id]").click()');await delay(3500);const side=BrowserWindow.getAllWindows().find(window=>window.getTitle()==='失物详情');assert.ok(side?.isVisible());
 const coldState=JSON.parse(native(`$h=[IntPtr]([long]${handle(side)});$cloak=0;[void][LafDesktopProbe]::DwmGetWindowAttribute($h,14,[ref]$cloak,4);@{visible=[LafDesktopProbe]::IsWindowVisible($h);minimized=[LafDesktopProbe]::IsIconic($h);topmost=([LafDesktopProbe]::GetWindowLong($h,-20) -band 8) -ne 0;cloaked=$cloak}|ConvertTo-Json -Compress`));console.log("first detail after Win+D",coldState);assert.deepEqual(coldState,{visible:true,minimized:false,topmost:true,cloaked:0});
 native("[LafDesktopProbe]::Toggle()");desktopShown=false;firstCover.destroy();
 const cover=new BrowserWindow({width:460,height:400});cover.show();cover.focus();native(`[LafDesktopProbe]::Focus([IntPtr]([long]${handle(cover)}))`);await delay(500);
 const hwnd=handle(win);
 native('[LafDesktopProbe]::Toggle()');desktopShown=true;await delay(500);
 const state=native(`$h=[IntPtr]([long]${hwnd});$cloak=0;[void][LafDesktopProbe]::DwmGetWindowAttribute($h,14,[ref]$cloak,4);@{visible=[LafDesktopProbe]::IsWindowVisible($h);minimized=[LafDesktopProbe]::IsIconic($h);topmost=([LafDesktopProbe]::GetWindowLong($h,-20) -band 8) -ne 0;cloaked=$cloak}|ConvertTo-Json -Compress`);
 const shown=JSON.parse(state);console.log('Win+D state',shown,native('$n=New-Object Text.StringBuilder 256;[void][LafDesktopProbe]::GetClassName([LafDesktopProbe]::GetForegroundWindow(),$n,256);$n.ToString()'));assert.equal(shown.visible,true);assert.equal(shown.minimized,false);assert.equal(shown.cloaked,0);assert.equal(shown.topmost,true);await win.webContents.executeJavaScript('window.laf.closeDetail()');await delay(300);assert.equal(side.isVisible(),false);
 win.focus();await win.webContents.executeJavaScript('document.querySelector("[data-id]").click()');await delay(500);assert.equal(side.isVisible(),true);
 const sideHwnd=handle(side);const sideState=JSON.parse(native(`$h=[IntPtr]([long]${sideHwnd});$cloak=0;[void][LafDesktopProbe]::DwmGetWindowAttribute($h,14,[ref]$cloak,4);@{visible=[LafDesktopProbe]::IsWindowVisible($h);minimized=[LafDesktopProbe]::IsIconic($h);topmost=([LafDesktopProbe]::GetWindowLong($h,-20) -band 8) -ne 0;cloaked=$cloak}|ConvertTo-Json -Compress`));assert.deepEqual(sideState,{visible:true,minimized:false,topmost:true,cloaked:0});
 native('[LafDesktopProbe]::Toggle()');desktopShown=false;cover.restore();cover.show();cover.focus();native(`[LafDesktopProbe]::Focus([IntPtr]([long]${handle(cover)}))`);await delay(500);console.log('after application switch',native('[LafDesktopProbe]::GetForegroundWindow().ToInt64()'),handle(cover));
 assert.equal(native(`([LafDesktopProbe]::GetWindowLong([IntPtr]([long]${hwnd}),-20) -band 8) -ne 0`),'False');assert.equal(native(`([LafDesktopProbe]::GetWindowLong([IntPtr]([long]${sideHwnd}),-20) -band 8) -ne 0`),'False');
 await win.webContents.executeJavaScript("window.laf.windowControl('minimize')");await delay(200);assert.equal(side.isVisible(),false);
 native('[LafDesktopProbe]::Toggle()');desktopShown=true;await delay(500);assert.equal(native(`[LafDesktopProbe]::IsIconic([IntPtr]([long]${hwnd}))`),'True');
 native('[LafDesktopProbe]::Toggle()');desktopShown=false;
 app.emit('second-instance');await delay(500);assert.equal(win.isMinimized(),false);
 cover.destroy();console.log('实际 Windows+D 验证通过（含首次展开和关闭后重开）：小窗可见、未最小化、未被遮蔽；主动最小化保留；切回应用恢复底层');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{
 if(desktopShown){try{native('[LafDesktopProbe]::Toggle()');}catch{}}
 app.emit('before-quit');app.exit(process.exitCode||0);
});

