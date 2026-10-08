const {BrowserWindow,screen}=require('electron');
const path=require('node:path');
module.exports=({main,settings,read,layer,onClose,saveWidth})=>{
 let window=null,current=null,revision=0,openSerial=0,timer,needsShow=true;
 function align(){
  if(!window||window.isDestroyed())return;
  const bounds=main().getBounds(),area=screen.getDisplayMatching(bounds).workArea,pref=settings().detailSide;
  const left=bounds.x-area.x-8,right=area.x+area.width-bounds.x-bounds.width-8;
  const side=(pref==='left'?left:right)>=300?pref:(pref==='left'?right:left)>=300?(pref==='left'?'right':'left'):pref;
  const available=side==='left'?left:right;
  const width=Math.round(Math.min(settings().detailWidth,Math.max(300,available),area.width));
  const x=side==='left'?bounds.x-width-8:bounds.x+bounds.width+8;
  const target={x:Math.max(area.x,Math.min(x,area.x+area.width-width)),y:Math.max(area.y,Math.min(bounds.y,area.y+area.height-Math.min(bounds.height,area.height))),width,height:Math.min(bounds.height,area.height)};
  const old=window.getBounds();if(Object.keys(target).some(key=>target[key]!==old[key]))window.setBounds(target);
  window.webContents.send('detail:position',side);
 }
 function create(){
  if(window&&!window.isDestroyed())return;
  window=new BrowserWindow({width:settings().detailWidth,height:main().getBounds().height,minWidth:300,minHeight:360,show:false,frame:false,transparent:true,resizable:false,skipTaskbar:true,backgroundColor:'#00000000',title:'失物详情',alwaysOnTop:settings().alwaysOnTop,webPreferences:{preload:path.join(__dirname,'preload-detail.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
  window.on('close',event=>{event.preventDefault();close();});
  // One native helper owns both windows, so Win+D state cannot diverge.
  layer()?.peer(window);
  window.on('closed',()=>{window=null;layer()?.peer(null);});
  window.loadFile(path.join(__dirname,'ui/detail.html'));
 }
 async function state(){
  if(!current)return {revision,item:null,settings:settings()};
  const data=await read();const item=data.items.find(item=>item.id===current&&item.status==='found');
  if(!item){close(false);return {revision,item:null,settings:settings()};}
  return {revision,item,settings:settings()};
 }
 async function open(id){
  if(!Number.isSafeInteger(id)||id<1)throw Error('记录序号无效');
  const serial=++openSerial;const data=await read();if(serial!==openSerial)return false;if(!data.items.some(item=>item.id===id&&item.status==='found'))throw Error('记录不可访问或已认领');
  clearTimeout(timer);current=id;revision++;create();if(!window.isVisible())align();window.webContents.send('detail:changed');return true;
 }
 function ready(version){
  if(version!==revision||!current)return false;
  if(main().isVisible()&&!main().isMinimized()&&(needsShow||!window.isVisible())){
   align();
   // Match the main desktop layer before showing: do not wait for the helper's
   // next poll after Win+D, which would briefly put the detail behind the shell.
   window.setAlwaysOnTop(settings().alwaysOnTop||main().isAlwaysOnTop());
   if(!window.isVisible())window.showInactive();needsShow=false;window.webContents.send('detail:show',revision);
  }return true;
 }
 function close(animate=true){
  ++openSerial;current=null;revision++;needsShow=true;clearTimeout(timer);onClose();if(!window)return true;
  const version=revision;window.webContents.send('detail:hide');
  const hide=()=>{if(version!==revision)return;window?.hide();};
  if(animate)timer=setTimeout(hide,180);else hide();return true;
 }
 async function resize(width){
  if(!Number.isFinite(width))throw Error('详情宽度无效');
  const value=Math.round(Math.max(300,Math.min(1000,width)));await saveWidth(value);align();return window?.getBounds().width??value;
 }
 function update(){if(!window)return;window.setAlwaysOnTop(settings().alwaysOnTop);align();window.webContents.send('detail:changed');}
 function destroy(){clearTimeout(timer);window?.destroy();}
 return {open,close,state,ready,resize,align,update,destroy,window:()=>window};
};
