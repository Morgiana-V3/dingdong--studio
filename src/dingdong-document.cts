import fs from 'node:fs'
import path from 'node:path'
import { renderArticles, articleDocument } from './push-articles.cjs'
import MarkdownIt from 'markdown-it'
import { parseHTML } from 'linkedom'
import type { Message } from './types.cjs'

export type ImageLoader = (url: string, budget: number, signal?: AbortSignal) => Promise<string>
const markdown = new MarkdownIt({ html: false, breaks: true })
const css = () => fs.readFileSync(path.join(__dirname, 'ui/assets/push-markdown.css'), 'utf8')
function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
export function compatibleLink(address: string): string | undefined {
  try {
    const url = new URL(address)
    if (
      url.protocol === 'twitter:' &&
      url.hostname === 'status' &&
      /^\d+$/.test(url.searchParams.get('id') || '')
    ) {
      return 'https://x.com/i/status/' + url.searchParams.get('id')
    }
    if (
      url.protocol === 'com.baidu.tieba:' &&
      url.hostname === 'unidispatch' &&
      url.pathname === '/pb' &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^\d{1,20}$/.test(url.searchParams.get('tid') || '')
    ) {
      return 'com.baidu.tieba://unidispatch/pb?tid=' + url.searchParams.get('tid')
    }
    if (['http:', 'https:', 'mailto:'].includes(url.protocol) && !url.username && !url.password) {
      return url.href
    }
    if (!url.username && !url.password && !url.port) {
      const id = url.pathname.slice(1)
      if (
        url.protocol === 'bilibili:' &&
        url.hostname === 'video' &&
        /^(BV[A-Za-z0-9]+|\d{1,25})$/.test(id)
      ) {
        return 'https://www.bilibili.com/video/' + (id.startsWith('BV') ? id : 'av' + id)
      }
      if (
        url.protocol === 'xhsdiscover:' &&
        url.hostname === 'item' &&
        /^[a-fA-F0-9]{24}$/.test(id)
      ) {
        const web = new URL('https://www.xiaohongshu.com/explore/' + id)
        for (const key of ['xsec_token', 'xsec_source']) {
          if (url.searchParams.has(key)) web.searchParams.set(key, url.searchParams.get(key)!)
        }
        return web.href
      }
    }
  } catch {
    /* Relative and unrecognized app links are not usable in the reader. */
  }
}
function digestHTML(message: Message): string {
  if (!Array.isArray(message.sections) || !message.sections.length || message.sections.length > 8) {
    throw new Error('汇总内容需包含 1–8 个来源')
  }
  const cards = message.sections
    .flatMap((section) => {
      const item = section?.message
      if (
        typeof section?.name !== 'string' ||
        section.name.length > 100 ||
        !item ||
        'sections' in item ||
        typeof item.body !== 'string'
      ) {
        throw new Error('汇总来源内容无效，不支持嵌套汇总')
      }
      let content: string
      if (item.articles) {
        const { document } = parseHTML(renderArticles(item.articles, item.title))
        return [...document.querySelectorAll('main > article')].map((card, index) => ({
          html: card.outerHTML,
          publishedAt: item.articles![index].publishedAt || 0,
        }))
      } else {
        if (item.format === 'html') {
          const source = /<html[\s>]/i.test(item.body)
            ? item.body
            : '<html><body>' + item.body + '</body></html>'
          const { document } = parseHTML(source)
          for (const element of document.querySelectorAll('style,script,link')) {
            element.remove()
          }
          for (const element of document.querySelectorAll('[style],[class],[id]')) {
            element.removeAttribute('style')
            element.removeAttribute('class')
            element.removeAttribute('id')
          }
          content = document.body.innerHTML
        } else {
          content =
            item.format === 'text'
              ? '<pre>' + escape(item.body) + '</pre>'
              : markdown.render(item.body)
        }
        content =
          '<article class="post digest-note"><header class="post-header"><div class="origin"><span class="source">' +
          escape(section.name) +
          '</span></div></header><div class="post-content">' +
          content +
          '</div></article>'
      }
      return [{ html: content, publishedAt: 0 }]
    })
    .sort((first, second) => second.publishedAt - first.publishedAt)
  return articleDocument(cards.map((card) => card.html).join(''), message.title)
}
export async function dingdongDocument(
  message: Message,
  loadImage?: ImageLoader,
  signal?: AbortSignal,
) {
  const format = message.articles || message.sections ? 'html' : message.format || 'markdown'
  if (!['markdown', 'html', 'text'].includes(format)) {
    throw new Error('不支持的消息正文格式')
  }
  let html = message.articles ? renderArticles(message.articles, message.title) : message.body
  if (message.sections) {
    html = digestHTML(message)
  }
  if (format !== 'html') {
    const body =
      format === 'text' ? `<pre>${escape(message.body)}</pre>` : markdown.render(message.body)
    html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css()}</style></head><body><main>${body}</main></body></html>`
  } else if (!/<html[\s>]/i.test(html)) {
    html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`
  }
  const { document } = parseHTML(html)
  for (const element of document.querySelectorAll(
    'script,iframe,object,embed,base,link,meta[http-equiv],form',
  )) {
    element.remove()
  }
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name)) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  for (const anchor of document.querySelectorAll('a')) {
    const url = compatibleLink(anchor.getAttribute('href') || '')
    if (url) {
      anchor.setAttribute('href', url)
    } else {
      anchor.removeAttribute('href')
    }
  }
  const inlineEmoticon = (image: HTMLImageElement) => {
    if (!image.classList.contains('tieba-emoticon')) {
      return
    }
    const span = document.createElement('span')
    span.className = 'tieba-emoticon'
    span.setAttribute('role', 'img')
    span.setAttribute('aria-label', image.getAttribute('alt') || '表情')
    span.setAttribute('style', `background-image:url("${image.getAttribute('src')}")`)
    image.replaceWith(span)
  }
  const images = [...document.querySelectorAll('img')]
  let omitted = 0
  // Allocate the whole message budget across unique resources, not repeated DOM nodes.
  // Small inline emoticons carry less weight than photos; unused bytes stay available.
  let remainingBytes = Math.max(0, 900000 - Buffer.byteLength(document.toString()))
  const weights = new Map<string, number>()
  for (const image of images) {
    const source = image.getAttribute('src') || ''
    if (!source.startsWith('data:'))
      weights.set(
        source,
        Math.max(weights.get(source) || 0, image.classList.contains('tieba-emoticon') ? 0.12 : 1),
      )
  }
  let remainingWeight = [...weights.values()].reduce((sum, weight) => sum + weight, 0)
  const imageFailures: Array<{ kind: 'photo' | 'emoticon'; host: string; reason: string }> = []
  const failed = new Map<string, string>()
  const cache = new Map<string, string>()
  const photos = new Set<string>()
  const emoticons = new Set<string>()
  for (const image of images) {
    signal?.throwIfAborted()
    const source = image.getAttribute('src') || ''
    image.removeAttribute('srcset')
    const inline = image.classList.contains('tieba-emoticon')
    const weight = weights.get(source) || 0
    const budget = Math.min(
      inline ? 32000 : 180000,
      Math.floor(remainingBytes * (remainingWeight ? weight / remainingWeight : 0) * 0.72),
    )
    if (weight) {
      remainingWeight -= weight
      weights.delete(source)
    }
    try {
      if (/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(source)) {
        inlineEmoticon(image)
        continue
      }
      if (failed.has(source)) throw new Error(failed.get(source))
      const sources = inline ? emoticons : photos
      if (
        !loadImage ||
        (!cache.has(source) && budget < 1000) ||
        (!cache.has(source) && sources.size >= (inline ? 40 : 80))
      ) {
        throw new Error(
          !loadImage ? '图片加载器不可用' : budget < 1000 ? '图片预算不足' : '图片数量上限',
        )
      }
      const url = new URL(source)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('Unsupported image')
      }
      const embedded =
        cache.get(source) ||
        (await loadImage(url.href, inline ? Math.min(32000, budget) : budget, signal))
      if (!/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(embedded)) {
        throw new Error('Invalid image')
      }
      if (!cache.has(source)) {
        const bytes = Buffer.byteLength(embedded)
        if (bytes > remainingBytes) throw new Error('图片预算不足')
        remainingBytes -= bytes
      }
      sources.add(source)
      cache.set(source, embedded)
      image.setAttribute('src', embedded)
      inlineEmoticon(image)
    } catch (error) {
      signal?.throwIfAborted()
      omitted++
      const message = error instanceof Error ? error.message : ''
      const reason =
        /^(?:配图 HTTP \d{3}|图片预算不足|图片数量上限|图片加载器不可用|配图格式不支持|配图过大|动图超过离线图片预算|配图格式不可用|配图压缩后仍超过预算|配图转换失败或超过预算)$/.test(
          message,
        )
          ? message
          : '图片下载或解码失败'
      failed.set(source, reason)
      let host = '未知地址'
      try {
        host = new URL(source).hostname
      } catch {
        /* No untrusted URL details in diagnostics. */
      }
      imageFailures.push({ kind: inline ? 'emoticon' : 'photo', host, reason })
      const note = document.createElement(inline ? 'span' : 'p')
      if (!inline) note.className = 'image-unavailable'
      note.textContent = inline
        ? image.getAttribute('alt') || '[表情]'
        : '配图未附入，可打开原文查看。'
      image.replaceWith(note)
    }
  }
  const policy = document.createElement('meta')
  policy.setAttribute('http-equiv', 'Content-Security-Policy')
  policy.setAttribute(
    'content',
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'",
  )
  document.head.prepend(policy)
  const content = document.toString()
  if (Buffer.byteLength(content, 'utf8') > 1000000) {
    throw new Error('叮咚正文超过 1 MB，请减少文字或图片后重试')
  }
  return { content, omitted, imageFailures }
}
