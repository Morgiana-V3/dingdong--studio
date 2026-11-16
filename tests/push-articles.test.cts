import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { renderArticles } from '../src/push-articles.cjs'
import { dingdongDocument } from '../src/dingdong-document.cjs'
import type { PushArticle } from '../src/types.cjs'

const base: PushArticle = {
  kind: 'tieba',
  title: '作品讨论',
  body: '首楼正文',
  url: 'https://tieba.baidu.com/p/123',
  source: '动画吧',
}
test('HTML posts preserve long original text behind a native disclosure and escape source markup', () => {
  const ending = '最后一段仍然存在'
  const body = '原文段落。'.repeat(120) + '\n\n' + ending
  const html = renderArticles(
    [
      {
        ...base,
        body,
        quote: '<script>untrusted()</script>',
        images: ['https://images.example/1.jpg', 'https://images.example/2.jpg'],
      },
    ],
    '阅读',
  )
  const { document } = parseHTML(html)
  assert.ok(document.querySelector('details'))
  assert.equal(document.querySelector('.full-text')!.textContent, body.replace(/\n\n/g, ''))
  assert.ok(document.querySelector('.original')!.textContent!.includes(ending))
  assert.equal(document.querySelectorAll('figure img').length, 2)
  assert.equal(document.querySelectorAll('script').length, 0)
  assert.ok(document.querySelector('.quote')!.textContent!.includes('<script>'))
  assert.equal(document.querySelectorAll('h1').length, 0)
  assert.equal(
    document.querySelector('h2 a')!.getAttribute('href'),
    'com.baidu.tieba://unidispatch/pb?tid=123',
  )
})
test('HTML video uses supplied title, cover and duration without inventing a video player', () => {
  const { document } = parseHTML(
    renderArticles(
      [
        {
          ...base,
          kind: 'bilibili',
          title: '视频标题',
          duration: '12:34',
          images: ['https://i0.hdslb.com/bfs/archive/cover.jpg'],
        },
      ],
      '视频订阅',
    ),
  )
  assert.equal(document.querySelector('.duration')!.textContent, '12:34')
  assert.equal(document.querySelectorAll('video,iframe,script').length, 0)
  assert.ok(document.querySelector('img.video-cover'))
  assert.equal(document.querySelector('h2 a')!.getAttribute('href'), base.url)
  assert.equal(document.querySelectorAll('footer').length, 0)
})
test('Structured articles take priority over Markdown and embedded image failures remain visible', async () => {
  const result = await dingdongDocument(
    {
      title: '任务名',
      body: '不得重复显示的旧 Markdown',
      articles: [{ ...base, images: ['https://images.example/offline.jpg'] }],
    },
    async () => {
      throw new Error('offline')
    },
  )
  assert.doesNotMatch(result.content, /不得重复显示的旧 Markdown/)
  assert.match(result.content, /作品讨论/)
  assert.match(result.content, /配图未附入/)
  assert.match(result.content, /Content-Security-Policy/)
  assert.equal(result.omitted, 1)
  assert.throws(() => renderArticles([{ ...base, url: 'javascript:evil()' }], '任务'), /原帖链接/)
  assert.throws(() => renderArticles([{ ...base, body: 'x'.repeat(13000) }], '任务'), /原帖链接/)
})

test('inline emoticons survive folding at the boundary, repeat in place and fail as inline labels', async () => {
  const url = 'https://tb2.bdstatic.com/tb/editor/images/client/image_emoticon16.png'
  const prefix = '字'.repeat(278)
  const body = prefix + '[阴险]后面[阴险]末尾'
  const article = {
    ...base,
    body,
    emoticons: [
      { offset: 278, length: 4, label: '[阴险]', url },
      { offset: 284, length: 4, label: '[阴险]', url },
    ],
  }
  const { document } = parseHTML(renderArticles([article], '任务'))
  assert.equal(document.querySelectorAll('details img.tieba-emoticon').length, 2)
  assert.equal(document.querySelector('.fold-preview p')?.textContent, prefix)
  assert.equal(document.querySelector('.full-text p')?.textContent, prefix + '后面末尾')
  const missing = await dingdongDocument(
    { title: '任务', body: '', articles: [article] },
    async () => {
      throw new Error('offline')
    },
  )
  const failed = parseHTML(missing.content).document
  assert.equal(failed.querySelectorAll('.full-text p span').length, 2)
  assert.match(failed.querySelector('.full-text p')!.textContent!, /\[阴险\]后面\[阴险\]末尾/)
  assert.doesNotMatch(missing.content, /配图未附入/)
  assert.throws(
    () =>
      renderArticles([{ ...article, emoticons: [{ ...article.emoticons[0], offset: 0 }] }], '任务'),
    /表情位置/,
  )
})

test('multi-photo posts use a compact grid while retaining individual image elements', () => {
  for (const count of [1, 2, 3, 4]) {
    const images = Array.from(
      { length: count },
      (_, index) => `https://images.example/${index}.jpg`,
    )
    const doc = parseHTML(renderArticles([{ ...base, images }], '图片')).document
    assert.equal(doc.querySelectorAll('.media img').length, count)
    assert.equal(doc.querySelectorAll('.media figcaption').length, 0)
    assert.ok(
      doc.querySelector(`.media-count-${count}.${count === 1 ? 'media-single' : 'media-grid'}`),
    )
    assert.equal(doc.querySelectorAll('.media a').length, 0)
  }
})
test('XHS topics strip machine markers, distinguish adjacent tags, escape HTML and preserve ordinary C# text', () => {
  const body =
    '正文 C#语言\n#AI工具#DeepSeek#AI插件#效率工具#AI干活[话题]#\n#漫画分享[话题]##独立漫画[话题]# #<script>危险</script>[话题]#'
  const doc = parseHTML(renderArticles([{ ...base, kind: 'xiaohongshu', body }], '话题')).document
  assert.equal(doc.querySelectorAll('.topic').length, 8)
  assert.doesNotMatch(doc.querySelector('.original')!.textContent!, /\[话题\]/)
  assert.match(doc.querySelector('.original')!.textContent!, /C#语言/)
  assert.equal(doc.querySelectorAll('script').length, 0)
  const folded = parseHTML(
    renderArticles(
      [
        {
          ...base,
          kind: 'xiaohongshu',
          body: '字'.repeat(358) + '#很长的话题名[话题]#' + '原文'.repeat(50),
        },
      ],
      '话题',
    ),
  ).document
  assert.doesNotMatch(folded.querySelector('.fold-preview')!.textContent!, /话题|#/)
  assert.equal(folded.querySelectorAll('.full-text .topic').length, 1)
})
test('digest image allocation admits more than ten photos, accounts for duplicates, and reports failures by kind', async () => {
  const pixel = 'data:image/png;base64,iVBORw0KGgo='
  const articles = Array.from({ length: 4 }, (_, group) => ({
    ...base,
    images: Array.from({ length: 4 }, (_, index) => `https://images.example/${group}-${index}.jpg`),
  }))
  let calls = 0
  const rendered = await dingdongDocument(
    { title: '汇总', body: '', articles },
    async (_url, budget) => {
      calls++
      assert.ok(budget > 20000)
      return pixel
    },
  )
  assert.equal(calls, 16)
  assert.equal(rendered.omitted, 0)
  assert.equal(parseHTML(rendered.content).document.querySelectorAll('.media img').length, 16)
  const failed = await dingdongDocument(
    {
      title: '失败',
      body: '',
      articles: [
        { ...base, images: ['https://images.example/1.jpg', 'https://images.example/2.jpg'] },
      ],
    },
    async () => {
      throw new Error('配图 HTTP 404')
    },
  )
  assert.equal(failed.imageFailures.length, 2)
  assert.equal(failed.imageFailures[0].reason, '配图 HTTP 404')
  assert.equal(
    parseHTML(failed.content).document.querySelectorAll('.media-grid .image-unavailable').length,
    2,
  )
})
