import type {
  FetchSession,
  TiebaEntry,
  TiebaPost,
  TiebaFeedInput,
  TiebaFeed,
  TiebaSearchInput,
} from './types.cjs'
interface RawPart {
  type?: string | number
  text?: string
  [key: string]: string | number | undefined
}
interface RawUser {
  id?: string | number
  name?: string
  name_show?: string
}
interface RawThread {
  id?: string | number
  title?: string
  author_id?: string | number
  author?: RawUser
  first_post_content?: RawPart[]
  abstract?: RawPart[]
  media?: RawPart[]
  reply_num?: string | number | null
  create_time?: number | string
  is_top?: number | string
}
interface RawPage {
  error_code?: string | number
  thread_list?: RawThread[]
  user_list?: RawUser[]
  thread?: RawThread
  post_list?: Array<{ floor?: number | string; content?: RawPart[]; author_id?: string | number }>
}
import crypto from 'node:crypto'
import type { InlineEmoticon } from './types.cjs'
import { tiebaEmoticonURL } from './tieba-emoticons.cjs'

// Protocol references and upstream attribution: THIRD_PARTY_NOTICES.txt.
function signParameters(parameters: Record<string, string>) {
  const digest = crypto.createHash('md5')
  for (const key of Object.keys(parameters).sort()) {
    digest.update(`${key}=${parameters[key]}`)
  }
  digest.update('tiebaclient!!!')
  return digest.digest('hex').toUpperCase()
}

function parseTarget(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 60 || /[\r\n<>/:]/.test(value)) {
    throw new Error('请填写完整吧名，例如 macmini，不含网址或“吧”后缀（名称本身含“吧”时保留）')
  }
  return { type: 'forum', name: value.trim() }
}

function contentWithEmoticons(content: RawPart[] | undefined, maximum: number) {
  let text = ''
  const emoticons: InlineEmoticon[] = []
  for (const part of Array.isArray(content) ? content : []) {
    if (['3', '20'].includes(String(part.type))) {
      continue
    }
    if (['2', '11'].includes(String(part.type))) {
      const label =
        '[' +
        String(part.c || '表情')
          .replace(/[\r\n]/g, ' ')
          .slice(0, 60) +
        ']'
      const url = tiebaEmoticonURL(String(part.text || ''))
      if (url && text.length + label.length <= maximum && emoticons.length < 100) {
        emoticons.push({ offset: text.length, length: label.length, label, url })
      }
      text += label
    } else {
      text += String(part.text || '').replace(/\r\n?/g, '\n')
    }
    if (text.length >= maximum) {
      break
    }
  }
  return { text: text.slice(0, maximum), emoticons }
}
function contentText(content: RawPart[] | undefined, maximum = 900) {
  return contentWithEmoticons(content, maximum).text
}

function imageURL(value: unknown) {
  if (typeof value !== 'string' || value.length > 1500) {
    return null
  }
  try {
    const url = new URL(value)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !['tiebapic.baidu.com', 'imgsrc.baidu.com', 'imgsa.baidu.com'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    ) {
      return null
    }
    url.protocol = 'https:'
    return url.href.replace(
      /[()'"<>\\]/g,
      (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase(),
    )
  } catch {
    return null
  }
}

function coverImages(item: { first_post_content?: RawPart[]; media?: RawPart[] }) {
  const parts = [
    ...(Array.isArray(item.first_post_content) ? item.first_post_content : []),
    ...(Array.isArray(item.media) ? item.media : []),
  ]
  const images: string[] = []
  for (const part of parts) {
    if (!['3', '20'].includes(String(part.type))) {
      continue
    }
    for (const field of [
      'origin_src',
      'origin_pic',
      'big_cdn_src',
      'src_pic',
      'cdn_src',
      'big_pic',
    ]) {
      const url = imageURL(part[field])
      if (url) {
        if (!images.includes(url)) {
          images.push(url)
        }
        break
      }
    }
    if (images.length === 4) {
      break
    }
  }
  return images
}

function normalizeCount(value: unknown) {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') {
    return null
  }
  const count = Number(value)
  return Number.isSafeInteger(count) && count >= 0 ? count : null
}

function normalizePage(body: RawPage): TiebaEntry[] {
  if (!Array.isArray(body.thread_list)) {
    throw new Error('贴吧未返回有效帖子列表，可能需要验证或接口已变化')
  }
  const authors = new Map(
    (body.user_list || []).map((user) => [
      String(user.id),
      String(user.name_show || user.name || ''),
    ]),
  )
  return body.thread_list
    .filter((item) => /^\d+$/.test(String(item.id)))
    .map((item) => ({
      id: String(item.id),
      title: String(item.title || '无标题帖子').slice(0, 200),
      author: (authors.get(String(item.author_id)) || '未知作者').slice(0, 100),
      body: contentText(item.first_post_content?.length ? item.first_post_content : item.abstract),
      images: coverImages(item),
      replyCount: normalizeCount(item.reply_num),
      createdAt: Number(item.create_time) > 0 ? Number(item.create_time) * 1000 : null,
      isTop: Boolean(Number(item.is_top)),
      url: `https://tieba.baidu.com/p/${item.id}`,
    }))
}

function normalizeFirstPost(body: RawPage, id: string): TiebaPost {
  if (String(body.thread?.id) !== id || !Array.isArray(body.post_list)) {
    throw new Error('贴吧未返回对应帖子的首楼')
  }
  const post = body.post_list.find((item) => Number(item.floor) === 1)
  if (!post || !Array.isArray(post.content)) {
    throw new Error('首楼不可读取，可能已删除或需要登录')
  }
  const author =
    (body.user_list || []).find((item) => String(item.id) === String(post.author_id)) ||
    body.thread!.author ||
    {}
  const { text, emoticons } = contentWithEmoticons(post.content, 10001)
  return {
    id,
    replyCount: normalizeCount(body.thread!.reply_num),
    body: text.slice(0, 10000),
    emoticons: emoticons.filter((item) => item.offset + item.length <= 10000),
    contentTruncated: text.length > 10000,
    images: coverImages({ first_post_content: post.content }),
    author: String(author.name_show || author.name || '').slice(0, 100),
  }
}

class Tieba {
  constructor(public session: FetchSession) {}

  async request(form: Record<string, string>, signal?: AbortSignal, endpoint = 'frs/page') {
    const parameters = { ...form, sign: signParameters(form) }
    let response
    try {
      response = await this.session.fetch(
        'https://tieba.baidu.com/c/' + (endpoint === 'searchpost' ? 's/' : 'f/') + endpoint,
        {
          method: 'POST',
          credentials: 'omit',
          redirect: 'error',
          headers: {
            Referer: 'https://tieba.baidu.com/',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams(parameters).toString(),
          signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
        },
      )
    } catch {
      throw new Error('贴吧连接失败或超时，请检查网络后重试')
    }
    if (!response.ok) {
      throw new Error(`贴吧返回 HTTP ${response.status}，请稍后重试`)
    }
    const body = (await response.json().catch(() => null)) as RawPage | null
    if (!body || typeof body !== 'object') {
      throw new Error('贴吧未返回有效数据，可能遇到验证或接口已变化')
    }
    if (body.error_code === undefined || Number(body.error_code) !== 0) {
      throw new Error(`贴吧拒绝读取（${body.error_code ?? '未知'}），请检查吧名或稍后重试`)
    }
    return body
  }

  async post(input: { id: string }, signal?: AbortSignal) {
    const id = String(input.id || '')
    if (!/^\d{1,20}$/.test(id)) {
      throw new Error('帖子编号无效')
    }
    const body = await this.request(
      {
        _client_type: '2',
        _client_version: '12.20.1.0',
        kz: id,
        pn: '1',
        rn: '2',
        r: '0',
        with_floor: '0',
      },
      signal,
      'pb/page',
    )
    return normalizeFirstPost(body, id)
  }

  async search(input: TiebaSearchInput, signal?: AbortSignal): Promise<TiebaFeed> {
    const target = parseTarget(input.target)
    if (
      typeof input.query !== 'string' ||
      !input.query.trim() ||
      input.query.length > 80 ||
      /[\r\n]/.test(input.query)
    )
      throw new Error('吧内搜索词需为 1–80 字')
    const raw = await this.request(
      {
        _client_version: '12.20.1.0',
        kw: target.name,
        word: input.query.trim(),
        only_thread: '1',
        pn: '1',
        rn: '20',
        sm: '1',
      },
      signal,
      'searchpost',
    )
    const body = raw as unknown as {
      post_list?: Array<{
        tid?: string
        title?: string
        content?: string
        fname?: string
        time?: string
      }>
    }
    if (!Array.isArray(body.post_list)) throw new Error('贴吧搜索结果格式已变化，不能视为没有结果')
    const clean = (value: unknown) =>
      String(value || '')
        .replace(/<[^>]*>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
    const entries = body.post_list
      .filter((item) => /^\d{1,20}$/.test(String(item.tid)) && item.fname === target.name)
      .slice(0, 20)
      .map((item) => ({
        id: String(item.tid),
        title: clean(item.title).slice(0, 200),
        body: clean(item.content).slice(0, 900),
        url: 'https://tieba.baidu.com/p/' + item.tid,
        replyCount: null,
        createdAt: Number(item.time) > 0 ? Number(item.time) * 1000 : null,
      }))
    return {
      mode: 'interests',
      target,
      entries,
      scopeDescription: '吧内关键词搜索首批，最多 20 条；回帖数需补读首楼',
    }
  }

  async feed(input: TiebaFeedInput, signal?: AbortSignal): Promise<TiebaFeed> {
    if (input.mode !== 'interests') {
      throw new Error('贴吧已改为兴趣精选，请更新插件并填写兴趣规则')
    }
    const target = parseTarget(input.target)
    const pageCount = input.pages ?? 1
    if (![1, 2].includes(pageCount)) throw new Error('贴吧列表每种排序最多读取 2 页')
    const pages = []
    for (const sort of ['1', '6']) {
      for (let page = 1; page <= pageCount; page++) {
        const body = await this.request(
          {
            _client_type: '2',
            _client_version: '12.20.1.0',
            pn: String(page),
            rn: '30',
            kw: target.name,
            sort_type: sort,
          },
          signal,
        )
        pages.push(normalizePage(body))
      }
    }
    const found = new Map<string, TiebaEntry>()
    for (let index = 0; index < Math.max(...pages.map((page) => page.length)); index++) {
      for (const page of pages) {
        const entry = page[index]
        if (entry && !found.has(entry.id) && found.size < 40 * pageCount) {
          found.set(entry.id, entry)
        }
      }
    }
    return {
      mode: 'interests',
      entries: [...found.values()],
      target,
      scopeDescription: `按发帖时间与最近回复各读取 ${pageCount} 页，最多 ${40 * pageCount} 条去重候选；不覆盖全吧历史`,
    }
  }
}

export {
  Tieba,
  parseTarget,
  signParameters,
  normalizePage,
  contentText,
  imageURL,
  normalizeFirstPost,
}
