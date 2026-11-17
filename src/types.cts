import type { XHSSource, XHSInput, XHSSearchInput, XHSDetailInput } from './xhs-types.cjs'
import type { XSource, XSearchInput, XDetailInput } from './x-types.cjs'
export interface Forum {
  name: string
  filter: string
}
export type ConfigValue = string | number | boolean | Forum[] | undefined
export type PluginConfig = Record<string, ConfigValue>
export type Schedule =
  { type: 'manual' } | { type: 'interval'; minutes: number } | { type: 'daily'; times: string[] }
export interface ScheduleInput {
  type?: string
  minutes?: number | string
  time?: string
  times?: string[]
}
export interface Message {
  title: string
  body: string
  short?: string
  format?: 'markdown' | 'html' | 'text'
  articles?: PushArticle[]
  sections?: Array<{ name: string; message: Omit<Message, 'sections'> }>
}
export interface InlineEmoticon {
  offset: number
  length: number
  label: string
  url: string
}
export interface PushArticle {
  kind: 'x' | 'tieba' | 'bilibili' | 'xiaohongshu'
  title: string
  body: string
  emoticons?: InlineEmoticon[]
  url: string
  source?: string
  images?: string[]
  quote?: string
  truncated?: boolean
  duration?: string
  publishedAt?: number
}
export interface Channel {
  id: string
  name: string
  kind: string
  secret?: string
  hasKey?: boolean
  baseUrl?: string
  source?: string
  silent?: boolean
}
export interface Provider {
  id: string
  name: string
  baseUrl: string
  model: string
  maxOutputTokens: number
  secret?: string
  hasKey?: boolean
}
export interface ProviderInput {
  id?: string
  name?: string
  baseUrl: string
  key?: string
  model?: string
  maxOutputTokens?: number | string
}
export interface ChannelInput {
  id?: string
  name: string
  kind: string
  key?: string
  baseUrl?: string
  source?: string
  silent?: boolean
}
export interface Task {
  id: string
  name: string
  pluginId: string
  channelId: string
  providerId: string
  schedule: ScheduleInput
  enabled: boolean
  onlyChanged: boolean
  config: PluginConfig
  nextRun: number | null
  pluginState?: unknown
  lastDigest?: string | null
}
export type TaskInput = Omit<Task, 'id' | 'nextRun' | 'pluginState' | 'lastDigest'> & {
  id?: string
}
export type TaskDraft = Partial<TaskInput>
export interface Trace {
  tool: string
  detail: string
  status: 'ok' | 'error'
  forum?: string
  at?: number
}
export interface RunRecord {
  id: string
  taskId: string
  name: string
  startedAt: number
  finishedAt?: number
  status: 'running' | 'sent' | 'partial' | 'skipped' | 'failed' | 'interrupted'
  detail: string
  trace?: Trace[]
  sourceFailures?: Array<{ taskId: string; name: string; detail: string }>
  message?: Message
  delivery?: { channelId: string; messageId: string; status: 'unknown' | 'queued' | 'received' }
}
export type Capability = 'xiaohongshu.read' | 'bilibili.read' | 'tieba.read' | 'x.read' | 'ai.tools'
export interface PluginField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'forums' | 'tasks'
  required?: boolean
  default?: ConfigValue
}
export interface Manifest {
  id: string
  name: string
  version: string
  apiVersion: number
  entry: string
  description?: string
  capabilities?: Capability[]
  fields: PluginField[]
}
export interface InstalledPlugin extends Manifest {
  location: string
}
export interface Settings {
  version: number
  channels: Channel[]
  providers: Provider[]
  tasks: Task[]
  history: RunRecord[]
  preferences: { startAtLogin: boolean; mobileChannelId?: string }
}
export interface Snapshot extends Settings {
  mobileControlStatus?: string
  plugins: InstalledPlugin[]
  running: string[]
}
export interface FunctionTool {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
  strict: boolean
}
// Responses items must preserve opaque reasoning fields when replayed to the API.
export interface ResponseItem {
  type?: string
  role?: string
  content?: string | Array<{ type: string; text?: string }>
  name?: string
  call_id?: string
  arguments?: string
  output?: string
  [field: string]: unknown
}
export interface ToolRequest {
  instructions: string
  input: ResponseItem[]
  tools: FunctionTool[]
}
export interface ToolResponse {
  output: ResponseItem[]
}
export interface AI {
  generate(prompt: string): Promise<string>
  respond(request: ToolRequest): Promise<ToolResponse>
}
export interface Video {
  id: string
  authorId: string
  author: string
  title: string
  description: string
  publishedAt: number
  url: string
  cover?: string
  duration?: string
}
export interface BiliAccount {
  loggedIn: boolean
  mid?: string
  name?: string
}
export interface BiliUser {
  mid: string
  name: string
  description: string
}
export interface BiliFeedInput {
  accountMid?: string
  since: number
  preview?: boolean
}
export interface BiliFeed {
  videos: Video[]
  complete: boolean
}
export interface TiebaEntry {
  id: string
  title: string
  body: string
  emoticons?: InlineEmoticon[]
  url: string
  author?: string
  images?: string[]
  replyCount?: number | null
  createdAt?: number | null
  isTop?: boolean
  contentTruncated?: boolean
}
export interface TiebaPost {
  id: string
  body: string
  emoticons?: InlineEmoticon[]
  author?: string
  images?: string[]
  replyCount?: number | null
  contentTruncated?: boolean
}
export interface TiebaFeedInput {
  target: string
  mode: string
  pages?: number
}
export interface TiebaSearchInput {
  target: string
  query: string
}
export interface TiebaFeed {
  mode: string
  entries: TiebaEntry[]
  target?: { type: string; name: string }
  scopeDescription?: string
}
export interface Sources {
  xiaohongshu: XHSSource
  x: XSource
  bilibili: { feed(input: BiliFeedInput): Promise<BiliFeed> }
  tieba: {
    search(input: TiebaSearchInput): Promise<TiebaFeed>
    feed(input: TiebaFeedInput): Promise<TiebaFeed>
    post(input: { id: string }): Promise<TiebaPost>
  }
}
export interface PluginContext<C = PluginConfig, S = unknown> {
  task?: { id?: string; name?: string }
  config: C
  state: S
  now: string
  sources: Sources
  ai: AI
  log?(event: Trace): void
}
export interface PluginResult<S = unknown> {
  message: Message | null
  state?: S
  detail?: string
}
export interface PluginModule {
  run(context: PluginContext): Promise<PluginResult>
}
export interface TiebaConfig {
  globalFilter: string
  forums: Forum[]
  maxItems: number
  minScore: number
  includeImages: boolean
}
export type NumericField = 'replyCount' | 'ageHours' | 'createdAt'
export type Operator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'ne'
export interface Condition {
  field: NumericField
  operator: Operator
  value: number
}
export interface Constraint {
  conditions: Condition[]
  match: 'all' | 'any'
}
export interface SelectedEntry extends TiebaEntry {
  score: number
  reason: string
  forum?: string
  constraints?: Constraint[]
  selectedAt?: number
  previewText?: string
}
export interface ForumState {
  sent?: string[]
  pending?: SelectedEntry[]
}
export interface TiebaState extends ForumState {
  version?: number
  target?: string
  forums?: Array<{ name: string; state: ForumState }>
}
export type TiebaContext = Omit<PluginContext<PluginConfig, TiebaState>, 'sources' | 'ai'> & {
  sources: Pick<Sources, 'tieba'>
  ai: Pick<AI, 'respond'>
}
export interface TiebaPreview {
  selected: SelectedEntry[]
  candidateCount: number
  evaluatedCount: number
  scopeDescription: string
  message: Message | null
  forums: Array<{ name: string; candidateCount: number; evaluatedCount: number }>
}
export type PreviewResponse = ({ error: string } | TiebaPreview) & { trace: Trace[] }
export interface FetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}
export type Fetcher = (url: string, options: RequestInit) => Promise<FetchResponse>
export interface FetchSession {
  fetch: Fetcher
}
export type WorkerMessage =
  | { type: 'trace'; event: Trace }
  | { type: 'done'; output: PluginResult }
  | { type: 'error'; error: string }
  | { type: 'bilibili'; id: number; input: BiliFeedInput }
  | { type: 'tieba'; id: number; action: 'post'; input: { id: string } }
  | { type: 'tieba'; id: number; action?: 'feed'; input: TiebaFeedInput }
  | { type: 'tieba'; id: number; action: 'search'; input: TiebaSearchInput }
  | { type: 'x'; id: number; action: 'following'; input: { accountId: string } }
  | { type: 'x'; id: number; action: 'search'; input: XSearchInput }
  | { type: 'x'; id: number; action: 'detail'; input: XDetailInput }
  | { type: 'xiaohongshu'; id: number; action: 'feed'; input: XHSInput }
  | { type: 'xiaohongshu'; id: number; action: 'search'; input: XHSSearchInput }
  | { type: 'xiaohongshu'; id: number; action: 'detail'; input: XHSDetailInput }
  | { type: 'ai-tools'; id: number; input: ToolRequest }
  | { type: 'ai'; id: number; prompt: string }
export type HostMessage =
  | { type: 'reply'; id: number; value?: unknown; error?: string }
  | {
      type: 'run'
      task: { id: string; name: string }
      entry: string
      config: PluginConfig
      state: unknown
      now: string
    }
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
