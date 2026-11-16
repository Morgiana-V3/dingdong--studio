import type { XPost } from './x-types.cjs'

type RecordValue = Record<string, unknown>
function record(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {}
}
function at(value: unknown, ...keys: string[]): unknown {
  for (const key of keys) {
    value = record(value)[key]
  }
  return value
}
function count(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return null
  }
  return value
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
function unescape(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}
function readableText(tweet: RecordValue, legacy: RecordValue, note: RecordValue): string {
  let content = unescape(text(note.text) || text(legacy.full_text))
  const media = at(legacy, 'extended_entities', 'media')
  // Only remove API-identified photo links; video links remain usable without a video player.
  for (const item of Array.isArray(media) ? media : []) {
    const shortUrl = text(at(item, 'url'))
    if (at(item, 'type') === 'photo' && /^https:\/\/t\.co\/\w+$/.test(shortUrl)) {
      content = content.replaceAll(shortUrl, '')
    }
  }
  const urls = at(note, 'entity_set', 'urls') || at(legacy, 'entities', 'urls')
  for (const entity of Array.isArray(urls) ? urls : []) {
    const shortUrl = text(at(entity, 'url'))
    if (!/^https:\/\/t\.co\/\w+$/.test(shortUrl)) {
      continue
    }
    try {
      const expanded = new URL(text(at(entity, 'expanded_url')))
      if (
        !['https:', 'http:'].includes(expanded.protocol) ||
        expanded.username ||
        expanded.password
      ) {
        continue
      }
      const linkedId = expanded.pathname.match(/\/status\/(\d+)(?:\/|$)/)?.[1]
      const ownId = text(tweet.rest_id) || text(legacy.id_str)
      const quoteId = text(at(tweet, 'quoted_status_result', 'result', 'rest_id'))
      const duplicate =
        ['x.com', 'twitter.com', 'www.twitter.com'].includes(expanded.hostname) &&
        linkedId &&
        [ownId, quoteId].includes(linkedId)
      content = content.replaceAll(shortUrl, duplicate ? '' : expanded.href)
    } catch {
      // Preserve unknown links instead of deleting potentially useful source material.
    }
  }
  return content
    .replace(/[\u200B\uFEFF]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
export function normalizeXPost(input: unknown, includeQuote = true): XPost | null {
  let tweet = record(input)
  if (tweet.__typename === 'TweetWithVisibilityResults') {
    tweet = record(tweet.tweet)
  }
  const legacy = record(tweet.legacy)
  const id = text(tweet.rest_id) || text(legacy.id_str)
  if (!/^\d{1,25}$/.test(id) || legacy.retweeted_status_result) {
    return null
  }
  const user = record(at(tweet, 'core', 'user_results', 'result'))
  const username = text(at(user, 'core', 'screen_name')) || text(at(user, 'legacy', 'screen_name'))
  const authorId = text(user.rest_id) || text(legacy.user_id_str)
  if (!/^[A-Za-z0-9_]{1,15}$/.test(username) || !/^\d+$/.test(authorId)) {
    return null
  }
  const note = record(at(tweet, 'note_tweet', 'note_tweet_results', 'result'))
  const body = readableText(tweet, legacy, note)
  const media = at(legacy, 'extended_entities', 'media')
  const images: string[] = []
  for (const item of Array.isArray(media) ? media : []) {
    if (at(item, 'type') !== 'photo') {
      continue
    }
    try {
      const url = new URL(text(at(item, 'media_url_https')))
      if (
        url.protocol === 'https:' &&
        url.hostname === 'pbs.twimg.com' &&
        url.pathname.startsWith('/media/') &&
        !url.username &&
        !url.password
      ) {
        images.push(url.href)
      }
    } catch {
      /* Missing or invalid media URLs are omitted. */
    }
  }
  const quoted = includeQuote
    ? normalizeXPost(at(tweet, 'quoted_status_result', 'result'), false)
    : null
  // A quote-only post has no commentary after its redundant t.co link is removed.
  // Its quoted text is still valid content, not an unknown response schema.
  if (!body && !images.length && !quoted) {
    return null
  }
  const created = Date.parse(text(legacy.created_at))
  return {
    id,
    authorId,
    username,
    text: body.slice(0, 10000),
    url: `https://x.com/${username}/status/${id}`,
    createdAt: Number.isFinite(created) ? created : null,
    likeCount: count(legacy.favorite_count),
    replyCount: count(legacy.reply_count),
    repostCount: count(legacy.retweet_count),
    images: images.slice(0, 4),
    truncated: body.length > 10000 || (!note.text && legacy.truncated === true),
    conversationId: text(legacy.conversation_id_str) || undefined,
    replyToId: text(legacy.in_reply_to_status_id_str) || undefined,
    ...(quoted
      ? { quoted: { id: quoted.id, text: quoted.text.slice(0, 2000), username: quoted.username } }
      : {}),
  }
}

export function parseXTimeline(body: unknown, kind: 'search' | 'detail' | 'following'): XPost[] {
  if (Array.isArray(at(body, 'errors')) && (at(body, 'errors') as unknown[]).length) {
    throw new Error('X 返回读取错误，请检查登录状态或稍后重试')
  }
  const instructions =
    kind === 'search'
      ? at(body, 'data', 'search_by_raw_query', 'search_timeline', 'timeline', 'instructions')
      : kind === 'following'
        ? at(body, 'data', 'home', 'home_timeline_urt', 'instructions')
        : at(body, 'data', 'threaded_conversation_with_injections_v2', 'instructions')
  if (!Array.isArray(instructions)) {
    throw new Error('X 返回格式已变化，不能把读取失败当作没有结果')
  }
  const posts = new Map<string, XPost>()
  function readItem(value: unknown) {
    const content = record(value)
    if (content.promotedMetadata || content.promoted_metadata) {
      return
    }
    const raw = at(content, 'tweet_results', 'result') || at(content, 'tweetResult', 'result')
    const post = normalizeXPost(raw)
    const unavailable = ['TweetTombstone', 'TweetUnavailable'].includes(text(at(raw, '__typename')))
    const retweet =
      at(raw, 'legacy', 'retweeted_status_result') ||
      at(raw, 'tweet', 'legacy', 'retweeted_status_result')
    if (raw && !post && !unavailable && !retweet) {
      throw new Error('X 帖子结构无法识别，请更新读取适配后重试')
    }
    if (post && posts.size < 80) {
      posts.set(post.id, post)
    }
  }
  for (const instruction of instructions) {
    const entries = at(instruction, 'entries')
    const single = at(instruction, 'entry')
    for (const entry of Array.isArray(entries) ? entries : single ? [single] : []) {
      if (text(at(entry, 'entryId')).startsWith('promoted-')) {
        continue
      }
      const content = at(entry, 'content')
      readItem(at(content, 'itemContent'))
      const items = at(content, 'items')
      for (const item of Array.isArray(items) ? items : []) {
        readItem(at(item, 'item', 'itemContent'))
      }
    }
  }
  return [...posts.values()]
}
