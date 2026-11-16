import type { MiniPushAPI } from '../ipc.cjs'
declare global {
  interface Window {
    miniPush: MiniPushAPI
  }
}
export {}
