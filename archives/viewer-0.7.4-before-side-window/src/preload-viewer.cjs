const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
contextBridge.exposeInMainWorld('laf', {
  openReaderWindow:()=>invoke('reader:open'),
  deviceInfo:()=>invoke('device:info'),refreshDevice:()=>invoke('device:refresh'),applyDevice:input=>invoke('device:apply',input),
  settings: () => invoke('settings:get'), saveSettings: input => invoke('settings:save', input),
  records: refresh => invoke('records:list', refresh), image: id => invoke('records:image', id),
  clearCache: () => invoke('cache:clear'),
  chooseCacheDirectory: () => invoke('cache:choose-directory'),
  cacheLocation: () => invoke('cache:location'),
  windowControl: command => invoke('window:controls', command),
  expandDetail: expanded => invoke('window:detail', expanded),
  resizeWindow: data => invoke('window:resize', data),
  setDetailWidth: width => invoke('window:detail-width', width),
  onSettingsChanged: callback => ipcRenderer.on('settings:changed', () => callback()),
});
