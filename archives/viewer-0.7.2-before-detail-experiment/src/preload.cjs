const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
contextBridge.exposeInMainWorld('laf', {
  settings: () => invoke('settings:get'), saveSettings: input => invoke('settings:save', input),
  records: refresh => invoke('records:list', refresh), image: id => invoke('records:image', id),
  clearCache: () => invoke('cache:clear'),
  user: () => invoke('auth:status'), login: body => invoke('auth:login', body),
  register: body => invoke('auth:register', body), logout: () => invoke('auth:logout'),
  api: (route, method = 'GET', body) => invoke('api', route, method, body),
  uploadImage: () => invoke('image:upload'),
  onSettingsChanged: callback => ipcRenderer.on('settings:changed', () => callback()),
});
