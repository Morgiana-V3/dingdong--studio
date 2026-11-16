import type { PushArticle } from '../../src/types.cjs'
import type { XConfig, XPost } from '../../src/x-types.cjs'

function plain(value: string): string {
  return value.replace(/[\\`*_{}\[\]<>#!|~]/g, '\\$&')
}
function destination(value: string): string {
  return value.replace(/[()'"<>\\\s]/g, (character) =>
    encodeURIComponent(character).replace(
      /[()']/g,
      (symbol) => '%' + symbol.charCodeAt(0).toString(16),
    ),
  )
}
function clean(value: string): string {
  return value
    .replace(/[\u200B\uFEFF]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
function excerpt(value: string, maximum: number): { text: string; clipped: boolean } {
  const characters = [...value]
  if (characters.length <= maximum) {
    return { text: value, clipped: false }
  }
  let prefix = characters.slice(0, maximum).join('')
  // Do not leave a cut URL or an English word in the excerpt.
  prefix = prefix.replace(/https?:\/\/\S*$/, '').replace(/\s+[A-Za-z0-9]+$/, '')
  const boundaries = [...prefix.matchAll(/[。！？!?；;\n]/g)]
  const boundary = boundaries.at(-1)?.index
  if (boundary !== undefined && boundary >= prefix.length * 0.55) {
    prefix = prefix.slice(0, boundary + 1)
  }
  return { text: prefix.trimEnd() + '…', clipped: true }
}
function heading(content: string): { title: string; remainder: string } {
  const firstLine = content.split('\n').find((line) => line.trim()) || ''
  const withoutLinks = firstLine.replace(/https?:\/\/\S+/g, '').trim()
  if (!withoutLinks) {
    return { title: '查看原帖', remainder: content }
  }
  const sentence = [...withoutLinks.matchAll(/[。！？!?](?:\s|$|(?=[^A-Za-z0-9]))/g)].find(
    (match) => [...withoutLinks.slice(0, match.index! + 1)].length >= 12,
  )
  const opening = sentence ? withoutLinks.slice(0, sentence.index! + 1) : withoutLinks
  // A complete opening slightly over the target reads better than an unfinished headline.
  const result =
    [...opening].length <= 64 ? { text: opening, clipped: false } : excerpt(opening, 42)
  // Remove the opening only when the title carries it verbatim and in full.
  const remainder =
    !result.clipped && content.startsWith(result.text)
      ? content.slice(result.text.length).trimStart()
      : content
  return { title: result.text, remainder }
}
function markdownText(value: string): string {
  const pieces: string[] = []
  let offset = 0
  for (const match of value.matchAll(/https?:\/\/[^\s<>]+/g)) {
    pieces.push(plain(value.slice(offset, match.index)))
    const address = match[0].replace(/[。！？！，；、,.!?;]+$/, '')
    try {
      const url = new URL(address)
      if (url.username || url.password) {
        throw new Error('Unsupported URL')
      }
      pieces.push(`[${plain(url.hostname.replace(/^www\./, ''))}](${destination(url.href)})`)
      pieces.push(plain(match[0].slice(address.length)))
    } catch {
      pieces.push(plain(match[0]))
    }
    offset = match.index! + match[0].length
  }
  pieces.push(plain(value.slice(offset)))
  // Preserve the author's individual lines in Markdown renderers.
  return pieces
    .join('')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\n/g, '  \n'))
    .join('\n\n')
}
export function format(posts: XPost[], config: XConfig, taskName = 'X 兴趣发现') {
  if (!posts.length) {
    return null
  }
  const titles: string[] = []
  const body = posts
    .map((post) => {
      if (!/^\d{1,25}$/.test(post.id) || !/^[A-Za-z0-9_]{1,15}$/.test(post.username)) {
        throw new Error('X 原帖链接信息不完整，无法生成推送')
      }
      const { title, remainder } = heading(clean(post.text))
      titles.push(title)
      const url = `https://x.com/${post.username}/status/${post.id}`
      const content = excerpt(remainder, 400)
      const blocks = [
        `## [${plain(title)}](twitter://status?id=${post.id})`,
        markdownText(content.text),
      ]
      if (content.clipped || post.truncated) {
        blocks.push('> 正文已节选，点击标题查看全文。')
      }
      const image = post.images[0]
      if (config.includeImages && image) {
        try {
          const source = new URL(image)
          if (
            source.protocol === 'https:' &&
            source.hostname === 'pbs.twimg.com' &&
            source.pathname.startsWith('/media/') &&
            !source.username &&
            !source.password
          ) {
            blocks.push(`![原帖配图](${destination(source.href)})`)
          }
        } catch {
          // Invalid media is omitted without breaking the message.
        }
      }
      if (post.quoted) {
        const quote = excerpt(clean(post.quoted.text), 140)
        blocks.push(`> 引用原文\n>\n> ${markdownText(quote.text).replace(/\n/g, '\n> ')}`)
      }
      blocks.push(`> [网页查看](${url})`)
      return blocks.filter(Boolean).join('\n\n')
    })
    .join('\n\n---\n\n')
  return {
    title: [...taskName.trim()].slice(0, 100).join('') || 'X 兴趣发现',
    body,
    articles: posts.map((post): PushArticle => {
      const opening = heading(clean(post.text))
      return {
        kind: 'x',
        publishedAt: post.createdAt ?? undefined,
        title: opening.title,
        body: opening.remainder,
        url: 'https://x.com/' + post.username + '/status/' + post.id,
        images: config.includeImages ? post.images.slice(0, 4) : [],
        quote: post.quoted?.text,
        truncated: post.truncated,
      }
    }),
    short: excerpt(titles.join(' · '), 120).text,
  }
}
