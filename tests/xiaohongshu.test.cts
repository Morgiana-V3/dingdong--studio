import { searchOutcome } from '../src/xhs-search.cjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { xhsAccount, xhsCount, xhsNotes, xhsNote as parseNote, xhsURL } from '../src/xhs-parser.cjs'
import { configValues, run, preview, matches } from '../examples/xiaohongshu/index.cjs'
import { collect } from '../examples/xiaohongshu/retrieval.cjs'
import { renderArticles } from '../src/push-articles.cjs'
import { accountId, noteId, xhsNote, xhsModel } from './helpers/xhs-fixtures.cjs'
import { call } from './helpers/tool-model.cjs'
import type { XHSContext } from '../src/xhs-types.cjs'
const config = { accountId, interests: 'AI 工具、漫画、二次元；评论超过 20', maxItems: 3 }
const fixture = () => ({
  id: noteId,
  xsecToken: 'Ab+/=',
  modelType: 'note',
  noteCard: {
    displayTitle: '原始标题',
    cover: { urlDefault: 'http://sns-webpic.xhscdn.com/example' },
    interactInfo: { likedCount: 0 },
    type: 'normal',
  },
})
function context(): XHSContext {
  return {
    config,
    state: {},
    now: new Date().toISOString(),
    sources: {
      xiaohongshu: {
        feed: async () => ({ notes: [xhsNote()], scope: '推荐' }),
        search: async () => ({ notes: [xhsNote()], scope: '搜索' }),
        detail: async (input) => xhsNote({ id: input.id }),
      },
    },
    ai: { respond: async (request) => xhsModel(request) },
  }
}
test('XHS account distinguishes guests, counts preserve zero and reject approximate values', () => {
  assert.equal(xhsAccount({ userId: accountId, guest: true }).loggedIn, false)
  assert.equal(xhsAccount({ userId: accountId, guest: false }).loggedIn, true)
  for (const value of ['1.2万', '2k', -1, Infinity]) assert.equal(xhsCount(value), null)
  assert.equal(xhsCount('123'), 123)
  assert.equal(xhsCount(0), 0)
})
test('XHS card/detail parsing preserves token, original text, time and safe images', () => {
  const card = parseNote(fixture())!
  assert.equal(card.likes, 0)
  assert.equal(new URL(card.url).searchParams.get('xsec_token'), 'Ab+/=')
  assert.equal(card.images[0], 'https://sns-webpic.xhscdn.com/example')
  assert.equal(card.publishedAt, null)
  const detail = parseNote(
    {
      noteId,
      title: '详情',
      desc: '首行\n第二行',
      time: 1794800000,
      interactInfo: { commentCount: '21', collectedCount: '1.2万' },
      imageList: [
        { urlDefault: 'https://evil.example/a' },
        { urlDefault: 'https://sns-webpic.xhscdn.com/a' },
      ],
    },
    card.token,
  )!
  assert.equal(detail.publishedAt, 1794800000000)
  assert.equal(detail.body, '首行\n第二行')
  assert.equal(detail.comments, 21)
  assert.equal(detail.collects, null)
  assert.deepEqual(detail.images, ['https://sns-webpic.xhscdn.com/a'])
  assert.equal(xhsNotes([fixture(), fixture()]).length, 1)
  assert.throws(() => xhsNotes({}), /结构/)
  assert.throws(() => xhsNotes([{ unknown: true }]), /识别/)
  assert.throws(() => xhsURL('../../evil', 'token'), /链接/)
})
test('XHS sources are independent, balanced and skip sent items by account', async () => {
  const ctx = context()
  const searches: string[] = []
  let feed = 0
  ctx.sources.xiaohongshu.feed = async () => {
    feed++
    return { notes: [xhsNote()], scope: '' }
  }
  ctx.sources.xiaohongshu.search = async ({ query }) => {
    searches.push(query)
    return { notes: [xhsNote()], scope: '' }
  }
  assert.equal((await collect(ctx, configValues(config))).catalog.size, 1)
  assert.equal(feed, 1)
  assert.deepEqual(searches, ['AI 工具', '漫画', '二次元'])
  ctx.state = { accountId, sent: [noteId] }
  assert.equal((await collect(ctx, configValues({ ...config, useSearch: false }))).catalog.size, 0)
  ctx.state.accountId = 'other'
  assert.equal((await collect(ctx, configValues({ ...config, useSearch: false }))).catalog.size, 1)
  assert.throws(() => configValues({ ...config, useSearch: false, useFeed: false }), /至少/)
})
test('XHS hard filters fail unknown counts, exact thresholds and missing date', () => {
  const conditions = [{ field: 'comments' as const, operator: 'gt' as const, value: 20 }]
  assert.equal(matches(xhsNote({ comments: 20 }), conditions, Date.now()), false)
  assert.equal(matches(xhsNote({ comments: null }), conditions, Date.now()), false)
  assert.equal(matches(xhsNote({ comments: 21 }), conditions, Date.now()), true)
  assert.equal(
    matches(
      xhsNote({ publishedAt: null }),
      [{ field: 'ageHours', operator: 'lte', value: 720 }],
      Date.now(),
    ),
    false,
  )
})
test('XHS reads original before selection, formats source cards, deduplicates only successful output', async () => {
  const ctx = context()
  const result = await run(ctx)
  assert.equal(result.message?.articles?.[0].body, xhsNote().body)
  assert.equal(result.message?.title, '小红书兴趣发现')
  assert.deepEqual(result.state.sent, [noteId])
  const html = renderArticles(result.message!.articles!, '汇总')
  assert.match(html, /post xiaohongshu/)
  assert.match(html, /xsec_token=fixture-token/)
  assert.doesNotMatch(html, /AI 推荐|推荐理由/)
  ctx.state = result.state
  assert.equal((await run(ctx)).message, null)
  assert.equal((await preview(ctx)).selected.length, 1)
})
test('XHS prevents unread selection and does not hide login or collection failures', async () => {
  const ctx = context()
  ctx.config.useSearch = false
  let index = 0
  ctx.ai.respond = async () =>
    ++index === 1
      ? call('filter_notes', { conditions: [] }, index)
      : call(
          'submit_selection',
          { selected: [{ id: noteId, score: 99 }], unavailableReason: '' },
          index,
        )
  await assert.rejects(run(ctx), /8 轮/)
  const failing = context()
  failing.sources.xiaohongshu.detail = async () => {
    throw new Error('小红书登录已失效')
  }
  await assert.rejects(run(failing), /登录已失效/)
  failing.sources.xiaohongshu.feed = async () => {
    throw new Error('小红书需要验证')
  }
  await assert.rejects(run(failing), /需要验证/)
})

test('XHS empty search requires successful response and explicit end marker', () => {
  assert.deepEqual(searchOutcome({ code: 0, success: true, data: { has_more: false } }), {
    empty: true,
  })
  assert.deepEqual(searchOutcome({ code: 0, success: true, data: { items: [{ id: 'note' }] } }), {})
  for (const response of [
    { code: 0, success: true, data: {} },
    { code: 0, success: true, data: { items: [], has_more: true } },
    { code: 300012, success: false, data: { items: [], has_more: false } },
    null,
  ])
    assert.ok(searchOutcome(response).error)
})
