import type { AI, PluginConfig, Trace, Message } from './types.cjs'

export interface XPost {
  id: string
  text: string
  authorId: string
  username: string
  url: string
  createdAt: number | null
  likeCount: number | null
  replyCount: number | null
  repostCount: number | null
  images: string[]
  truncated: boolean
  conversationId?: string
  replyToId?: string
  quoted?: { id: string; text: string; username: string }
}
export interface XAccount {
  hasSession: boolean
  id?: string
}
export interface XSearchInput {
  accountId: string
  query: string
  sort: 'Latest' | 'Top'
}
export interface XDetailInput {
  accountId: string
  id: string
}
export interface XSearchResult {
  posts: XPost[]
  query: string
  scope: string
}
export interface XDetail {
  post: XPost
  thread: XPost[]
  scope: string
}
export interface XSource {
  following(input: { accountId: string }): Promise<XSearchResult>
  search(input: XSearchInput): Promise<XSearchResult>
  detail(input: XDetailInput): Promise<XDetail>
}
export interface XConfig {
  accountId: string
  interests: string
  maxItems: number
  includeImages: boolean
  useFollowing?: boolean
  useSearch?: boolean
}
export interface XContext {
  task?: { id?: string; name?: string }
  config: PluginConfig
  state: { accountId?: string; sent?: string[] }
  now: string
  sources: { x: XSource }
  ai: Pick<AI, 'respond'>
  log?(event: Trace): void
}
export interface XPreview {
  selected: XPost[]
  candidateCount: number
  message: Message | null
}
export type XPreviewResponse = ({ error: string } | XPreview) & { trace: Trace[] }
