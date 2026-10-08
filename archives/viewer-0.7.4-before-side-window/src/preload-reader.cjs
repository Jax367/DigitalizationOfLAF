const {contextBridge,ipcRenderer}=require('electron');
async function invoke(channel,...args){const result=await ipcRenderer.invoke(channel,...args);if(!result.ok)throw Error(result.error);return result.value;}
contextBridge.exposeInMainWorld('laf',{
 settings:()=>invoke('settings:get'),records:refresh=>invoke('records:list',refresh),image:id=>invoke('records:image',id),
 onSettingsChanged:callback=>ipcRenderer.on('settings:changed',()=>callback()),
});
