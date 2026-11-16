import fs from 'node:fs'
import path from 'node:path'
import type { PushArticle, InlineEmoticon } from './types.cjs'

const stylesheet = () => fs.readFileSync(path.join(__dirname, 'ui/assets/push-content.css'), 'utf8')
function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
function webLink(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
      return url.href
    }
  } catch {
    /* Unsupported content is displayed without an active link. */
  }
}
const topicPattern = /#([^#\r\n]{1,80})\[话题\]#|#[\p{L}\p{N}_][\p{L}\p{N}_-]{0,59}/gu
function plainText(value: string, topics: boolean): string {
  if (!topics) return escape(value)
  let html = '',
    offset = 0
  for (const match of value.matchAll(topicPattern)) {
    if (
      !match[1] &&
      match.index !== offset &&
      /[\p{L}\p{N}_/]/u.test(value[(match.index || 0) - 1] || '')
    )
      continue
    html += escape(value.slice(offset, match.index))
    const label = match[1] ? '#' + match[1].trim() : match[0]
    html += `<span class="topic">${escape(label)}</span>`
    offset = match.index! + match[0].length
  }
  return html + escape(value.slice(offset))
}
function linkedText(value: string, topics = false): string {
  const pieces: string[] = []
  let offset = 0
  for (const match of value.matchAll(/https?:\/\/[^\s<>]+/g)) {
    pieces.push(plainText(value.slice(offset, match.index), topics))
    const address = match[0].replace(/[。！？！，；、,.!?;]+$/, '')
    const url = webLink(address)
    pieces.push(
      url
        ? `<a class="inline-link" href="${escape(url)}">${escape(new URL(url).hostname.replace(/^www\./, ''))}</a>${escape(match[0].slice(address.length))}`
        : escape(match[0]),
    )
    offset = match.index! + match[0].length
  }
  pieces.push(plainText(value.slice(offset), topics))
  return pieces.join('')
}
function textHTML(value: string, emoticons: InlineEmoticon[] = [], topics = false): string {
  let html = ''
  let offset = 0
  for (const emoticon of emoticons) {
    html += linkedText(value.slice(offset, emoticon.offset), topics)
    html += `<img class="tieba-emoticon" src="${escape(emoticon.url)}" alt="${escape(emoticon.label)}" width="30" height="30">`
    offset = emoticon.offset + emoticon.length
  }
  html += linkedText(value.slice(offset), topics)
  return html
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('')
}
function foldText(
  value: string,
  limit: number,
  emoticons: InlineEmoticon[] = [],
  topics = false,
): string {
  const content = emoticons.length ? value : value.replace(/\r\n?/g, '\n').trim()
  const characters = [...content]
  if (characters.length <= limit) {
    return textHTML(content, emoticons, topics)
  }
  let prefix = characters.slice(0, limit).join('')
  const boundary = Math.max(
    prefix.lastIndexOf('\n'),
    prefix.lastIndexOf('。'),
    prefix.lastIndexOf('！'),
    prefix.lastIndexOf('？'),
    prefix.lastIndexOf('. '),
  )
  if (boundary > prefix.length * 0.45) {
    prefix = prefix.slice(0, boundary + 1)
  } else {
    prefix = prefix.replace(/https?:\/\/\S*$/, '').replace(/\s+[A-Za-z0-9]+$/, '')
  }
  if (topics) {
    const cut = [...content.matchAll(topicPattern)].find(
      (match) => match.index! < prefix.length && match.index! + match[0].length > prefix.length,
    )
    if (cut) prefix = content.slice(0, cut.index)
  }
  const crossing = emoticons.find(
    (item) => item.offset < prefix.length && item.offset + item.length > prefix.length,
  )
  if (crossing) {
    prefix = content.slice(0, crossing.offset)
  }
  const leading = emoticons.filter((item) => item.offset + item.length <= prefix.length)
  return `<details class="more"><summary><div class="fold-preview">${textHTML(prefix, leading, topics)}</div><span class="more-toggle">展开全文</span></summary><div class="full-text">${textHTML(content, emoticons, topics)}</div></details>`
}
function validate(article: PushArticle) {
  if (
    !article ||
    !['x', 'tieba', 'bilibili', 'xiaohongshu'].includes(article.kind) ||
    typeof article.title !== 'string' ||
    article.title.length > 500 ||
    typeof article.body !== 'string' ||
    article.body.length > 12000 ||
    typeof article.url !== 'string' ||
    !webLink(article.url)
  ) {
    throw new Error('图文条目的标题、正文或原帖链接无效')
  }
  if (
    article.images !== undefined &&
    (!Array.isArray(article.images) ||
      article.images.length > 4 ||
      article.images.some((image) => typeof image !== 'string' || image.length > 3000))
  ) {
    throw new Error('每条图文最多支持 4 张有效图片')
  }
  if (article.emoticons !== undefined) {
    if (!Array.isArray(article.emoticons) || article.emoticons.length > 100) {
      throw new Error('表情数量或格式无效')
    }
    let end = 0
    for (const item of article.emoticons) {
      if (
        !item ||
        !Number.isInteger(item.offset) ||
        !Number.isInteger(item.length) ||
        item.offset < end ||
        item.length < 1 ||
        typeof item.label !== 'string' ||
        item.label.length > 62 ||
        /[\r\n]/.test(item.label) ||
        typeof item.url !== 'string' ||
        article.body.slice(item.offset, item.offset + item.length) !== item.label ||
        !/^https:\/\/tb2\.bdstatic\.com\/tb\/editor\/images\/[A-Za-z0-9_]+\/[A-Za-z0-9_]+\.(png|gif)$/.test(
          item.url,
        )
      ) {
        throw new Error('表情位置或图片地址无效')
      }
      end = item.offset + item.length
    }
  }
  if (
    article.publishedAt !== undefined &&
    (!Number.isSafeInteger(article.publishedAt) || article.publishedAt <= 0)
  ) {
    throw new Error('图文发布时间需为有效的 Unix 毫秒时间')
  }
  for (const field of ['source', 'quote', 'duration'] as const) {
    if (
      article[field] !== undefined &&
      (typeof article[field] !== 'string' || article[field]!.length > 3000)
    ) {
      throw new Error('图文附加内容格式无效')
    }
  }
}
function articleLink(article: PushArticle): string {
  const url = new URL(article.url)
  const post = /^\/p\/(\d{1,20})\/?$/.exec(url.pathname)
  if (article.kind === 'tieba' && url.hostname === 'tieba.baidu.com' && post) {
    return 'com.baidu.tieba://unidispatch/pb?tid=' + post[1]
  }
  return article.url
}
export function renderArticles(articles: PushArticle[], title: string): string {
  if (!Array.isArray(articles) || !articles.length || articles.length > 20) {
    throw new Error('一条消息需包含 1–20 个图文条目')
  }
  const sections = articles
    .map((article) => {
      validate(article)
      const name = { x: 'X', tieba: '贴吧', bilibili: 'B 站', xiaohongshu: '小红书' }[article.kind]
      const source = article.source || name
      const label = `<div class="origin"><span class="platform ${article.kind}">${name}</span>${source !== name ? `<span class="source">${escape(source)}</span>` : ''}${article.duration ? `<span class="duration">${escape(article.duration)}</span>` : ''}</div>`
      const heading = `<h2><a href="${escape(articleLink(article))}">${escape(article.title || '查看原帖')}</a></h2>`
      const addresses = [...new Set(article.images || [])].filter((image) =>
        Boolean(webLink(image)),
      )
      const count = addresses.length
      const photos = addresses
        .map(
          (image) =>
            `<figure><img src="${escape(image)}" alt="${article.kind === 'bilibili' ? '视频封面' : '原帖配图'}"${article.kind === 'bilibili' ? ' class="video-cover"' : ''}></figure>`,
        )
        .join('')
      const images = count
        ? `<div class="media ${count > 1 ? 'media-grid' : 'media-single'} media-count-${count}">${photos}</div>`
        : ''
      const body = `<div class="original">${foldText(article.body, article.kind === 'tieba' ? 280 : 360, article.emoticons, article.kind === 'xiaohongshu')}</div>`
      const quote = article.quote?.trim()
        ? `<aside class="quote"><div class="quote-label">引用原文</div>${foldText(article.quote, 180)}</aside>`
        : ''
      const truncated = article.truncated
        ? '<p class="partial">仅获取到部分原文，完整内容请打开原帖。</p>'
        : ''
      const content = article.kind === 'bilibili' ? images + body : body + images
      return `<article class="post ${article.kind}"><header class="post-header">${label}<span class="paperclip" aria-hidden="true"></span></header><div class="post-content">${heading}${content}${quote}${truncated}</div></article>`
    })
    .join('')
  return articleDocument(sections, title)
}
export function articleDocument(content: string, title: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${stylesheet()}</style></head><body><main>${content}</main></body></html>`
}
