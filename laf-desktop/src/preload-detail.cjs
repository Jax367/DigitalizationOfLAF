const {contextBridge,ipcRenderer}=require('electron');
async function invoke(channel,...args){const result=await ipcRenderer.invoke(channel,...args);if(!result.ok)throw Error(result.error);return result.value;}
contextBridge.exposeInMainWorld('lafDetail',{
 state:()=>invoke('detail:state'),ready:revision=>invoke('detail:ready',revision),close:()=>invoke('detail:close'),image:id=>invoke('records:image',id),width:value=>invoke('detail:width',value),
 onChange:callback=>ipcRenderer.on('detail:changed',callback),onShow:callback=>ipcRenderer.on('detail:show',callback),onHide:callback=>ipcRenderer.on('detail:hide',callback),onPosition:callback=>ipcRenderer.on('detail:position',(_event,side)=>callback(side)),
});
