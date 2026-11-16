import type { XHSNote, XHSAccount } from './xhs-types.cjs'
type Dict = Record<string, unknown>
const obj = (value: unknown): Dict =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Dict) : {}
const str = (value: unknown) => (typeof value === 'string' ? value : '')
export function xhsCount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null
  const count = Number(value)
  // Abbreviations like 1.2万 are not precise enough for strict numerical filters.
  return Number.isSafeInteger(count) ? count : null
}
export function xhsAccount(value: unknown): XHSAccount {
  const info = obj(value)
  const id = str(info.userId || info.user_id)
  return !info.guest && /^[a-f0-9]{24}$/i.test(id)
    ? { loggedIn: true, id, name: str(info.nickname).slice(0, 80) }
    : { loggedIn: false }
}
function image(value: unknown): string | undefined {
  try {
    const url = new URL(str(value))
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !(url.hostname === 'xhscdn.com' || url.hostname.endsWith('.xhscdn.com')) ||
      url.username ||
      url.password
    )
      return
    url.protocol = 'https:'
    return url.href
  } catch {
    return
  }
}
export function xhsURL(id: string, token: string): string {
  if (!/^[a-f0-9]{24}$/i.test(id) || !token || token.length > 500 || /[\s\x00-\x1f]/.test(token))
    throw new Error('小红书笔记链接信息不完整')
  const url = new URL('https://www.xiaohongshu.com/explore/' + id)
  url.searchParams.set('xsec_token', token)
  url.searchParams.set('xsec_source', 'pc_feed')
  return url.href
}
export function xhsNote(value: unknown, fallbackToken = ''): XHSNote | null {
  const raw = obj(value)
  if (raw.modelType && raw.modelType !== 'note') return null
  const note = obj(raw.noteCard || raw.note_card || raw)
  const id = str(raw.id || note.noteId || note.note_id || note.id)
  const token = str(raw.xsecToken || raw.xsec_token || note.xsecToken || fallbackToken)
  if (!/^[a-f0-9]{24}$/i.test(id) || !token) return null
  const interaction = obj(note.interactInfo || note.interact_info)
  const images: string[] = []
  const candidates = Array.isArray(note.imageList) ? note.imageList : [note.cover]
  for (const candidate of candidates) {
    const item = obj(candidate)
    const infos = Array.isArray(item.infoList) ? item.infoList : []
    const address = image(item.urlDefault || item.url || item.urlPre || obj(infos[0]).url)
    if (address && !images.includes(address)) images.push(address)
    if (images.length === 4) break
  }
  const time = typeof note.time === 'number' ? note.time : 0
  const publishedAt =
    time > 0 && Number.isSafeInteger(time) ? (time < 100000000000 ? time * 1000 : time) : null
  const body = str(note.desc || note.description)
  return {
    id,
    token,
    title: str(note.displayTitle || note.title).slice(0, 500) || '查看笔记',
    body: body.slice(0, 12000),
    url: xhsURL(id, token),
    images,
    publishedAt,
    likes: xhsCount(interaction.likedCount ?? interaction.liked_count),
    comments: xhsCount(interaction.commentCount ?? interaction.comment_count),
    collects: xhsCount(interaction.collectedCount ?? interaction.collected_count),
    video: note.type === 'video',
    truncated: body.length > 12000,
  }
}
export function xhsNotes(value: unknown): XHSNote[] {
  if (!Array.isArray(value)) throw new Error('小红书列表结构发生变化，请更新读取适配')
  const result = new Map<string, XHSNote>()
  for (const raw of value.slice(0, 100)) {
    const note = xhsNote(raw)
    if (note && result.size < 30) result.set(note.id, note)
  }
  if (value.length && !result.size)
    throw new Error('小红书没有可识别的笔记，可能需要登录验证或更新适配')
  return [...result.values()]
}
