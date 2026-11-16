import type { XHSAccount, XHSPreviewResponse } from './xhs-types.cjs'
import type { XAccount, XSearchInput, XSearchResult, XPreviewResponse } from './x-types.cjs'
import type { Bilibili } from './bilibili.cjs'
import type { Tieba } from './tieba.cjs'
import type {
  Snapshot,
  Manifest,
  ChannelInput,
  ProviderInput,
  TaskInput,
  PluginConfig,
  PreviewResponse,
  RunRecord,
} from './types.cjs'

export interface Handlers {
  installXHS(): Manifest
  xhsLogin(): Promise<void>
  xhsAccount(): Promise<XHSAccount>
  xhsLogout(): Promise<void>
  xhsInterestPreview(input: {
    providerId: string
    config: PluginConfig
  }): Promise<XHSPreviewResponse>
  snapshot(): Snapshot
  importPlugin(): Promise<Manifest | null>
  addExample(): Manifest
  installBilibili(): Manifest
  bilibiliLogin(): ReturnType<Bilibili['login']>
  bilibiliAccount(): ReturnType<Bilibili['account']>
  bilibiliLogout(): Promise<void>
  bilibiliFollowings(input: {
    accountMid?: string
    page?: number
  }): ReturnType<Bilibili['followings']>
  bilibiliPreview(input: { accountMid?: string }): ReturnType<Bilibili['feed']>
  installX(): Manifest
  xSearchPreview(input: XSearchInput): Promise<XSearchResult>
  xInterestPreview(input: { providerId: string; config: PluginConfig }): Promise<XPreviewResponse>
  xLogin(): Promise<void>
  xLoginChrome(): Promise<void>
  xImportChromeSession(): Promise<void>
  xAccount(): Promise<XAccount>
  xRefreshSession(): Promise<XAccount>
  xLogout(): Promise<void>
  installTieba(): Manifest
  tiebaPreview(input: { target: string }): ReturnType<Tieba['feed']>
  tiebaInterestPreview(input: {
    providerId: string
    config: PluginConfig
  }): Promise<PreviewResponse>
  deletePlugin(id: string): void
  saveChannel(input: ChannelInput): void
  deleteChannel(id: string): void
  testChannel(id: string): Promise<string>
  checkDelivery(id: string): Promise<string>
  previewDelivery(id: string): Promise<void>
  saveProvider(input: ProviderInput): void
  listModels(input: ProviderInput): Promise<string[]>
  deleteProvider(id: string): void
  testProvider(id: string): Promise<string>
  saveTask(input: TaskInput): void
  toggleTask(id: string): void
  deleteTask(id: string): void
  runTask(id: string): Promise<RunRecord>
  cancelTask(id: string): void
  preferences(input: { startAtLogin: boolean }): void
  openExamples(): Promise<string>
}
export interface MiniPushAPI {
  invoke<K extends keyof Handlers>(
    action: K,
    ...payload: Parameters<Handlers[K]>
  ): Promise<Awaited<ReturnType<Handlers[K]>>>
  onChange(callback: () => void): () => void
}
