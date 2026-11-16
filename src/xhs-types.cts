import type { AI, PluginConfig, Trace, Message } from './types.cjs'
export interface XHSAccount {
  loggedIn: boolean
  id?: string
  name?: string
}
export interface XHSNote {
  id: string
  token: string
  title: string
  body: string
  url: string
  images: string[]
  publishedAt: number | null
  likes: number | null
  comments: number | null
  collects: number | null
  video: boolean
  truncated: boolean
}
export interface XHSInput {
  accountId: string
}
export interface XHSSearchInput extends XHSInput {
  query: string
}
export interface XHSDetailInput extends XHSInput {
  id: string
  token: string
}
export interface XHSFeed {
  notes: XHSNote[]
  scope: string
}
export interface XHSSource {
  feed(input: XHSInput): Promise<XHSFeed>
  search(input: XHSSearchInput): Promise<XHSFeed>
  detail(input: XHSDetailInput): Promise<XHSNote>
}
export interface XHSContext {
  task?: { name?: string }
  config: PluginConfig
  state: { accountId?: string; sent?: string[] }
  now: string
  sources: { xiaohongshu: XHSSource }
  ai: Pick<AI, 'respond'>
  log?(event: Trace): void
}
export interface XHSPreview {
  selected: XHSNote[]
  candidateCount: number
  message: Message | null
}
export type XHSPreviewResponse = (XHSPreview | { error: string }) & { trace: Trace[] }
