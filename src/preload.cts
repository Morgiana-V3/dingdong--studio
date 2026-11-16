import type { MiniPushAPI } from './ipc.cjs'
import { contextBridge, ipcRenderer } from 'electron'

const api: MiniPushAPI = {
  async invoke(action, ...payload) {
    const response = await ipcRenderer.invoke('invoke', action, ...payload)
    if (response.error) {
      throw new Error(response.error)
    }
    return response.value
  },
  onChange(callback) {
    const listener = () => callback()
    ipcRenderer.on('changed', listener)
    return () => ipcRenderer.removeListener('changed', listener)
  },
}
contextBridge.exposeInMainWorld('miniPush', api)
