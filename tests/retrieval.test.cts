import test from 'node:test'
import assert from 'node:assert/strict'
import { collect as collectX } from '../examples/x/retrieval.cjs'
import { collect as collectTieba } from '../examples/tieba/retrieval.cjs'
import { run as runX } from '../examples/x/index.cjs'
import { Tieba } from '../src/tieba.cjs'
import { call } from './helpers/tool-model.cjs'
import { xPost, xModel } from './helpers/x-fixtures.cjs'
import { testDouble } from './helpers/fixtures.cjs'
import type { XContext, XConfig } from '../src/x-types.cjs'
import type { TiebaContext, TiebaConfig, TiebaEntry } from '../src/types.cjs'

const config: XConfig = {
  accountId: '100',
  interests: 'AI、漫画',
  maxItems: 3,
  includeImages: false,
}
function xContext(): XContext {
  return {
    config: { ...config },
    state: {},
    now: new Date().toISOString(),
    sources: {
      x: {
        following: async () => ({ posts: [xPost({ id: '1' })], query: '', scope: '关注' }),
        search: async ({ query }) => ({ posts: [xPost({ id: '2' })], query, scope: '搜索' }),
        detail: async ({ id }) => ({ post: xPost({ id }), thread: [], scope: '' }),
      },
    },
    ai: { respond: async (request) => xModel(request) },
  }
}
test('X plugin combines following plus every planned topic in both orders and deduplicates origins', async () => {
  const ctx = xContext()
  const calls: string[] = []
  ctx.ai.respond = async () =>
    call(
      'plan_searches',
      {
        queries: [
          { topic: 'AI', query: '(LLM OR model)' },
          { topic: '漫画', query: '漫画 lang:zh' },
        ],
      },
      1,
    )
  ctx.sources.x.search = async ({ query, sort }) => {
    calls.push(query + ' ' + sort)
    return {
      query,
      scope: '',
      posts: [xPost({ id: '1' }), xPost({ id: query.startsWith('(') ? '2' : '3' })],
    }
  }
  const result = await collectX(ctx, config)
  assert.equal(calls.length, 4)
  assert.deepEqual(
    result.posts.map((p) => p.id),
    ['1', '2', '3'],
  )
  assert.ok(result.origins.get('1')!.has('关注时间线'))
  assert.equal(result.origins.get('1')!.size, 5)
  assert.ok(calls.some((q) => q === '漫画 lang:zh Top'))
})
test('X supports following-only with no planner or search; invalid plans and failures do not become empty success', async () => {
  const ctx = xContext()
  ctx.ai.respond = async () => {
    throw new Error('planner should not run')
  }
  assert.equal((await collectX(ctx, { ...config, useSearch: false })).posts.length, 1)
  ctx.ai.respond = async () =>
    call(
      'plan_searches',
      {
        queries: [
          { topic: 'a', query: 'same' },
          { topic: 'b', query: 'same' },
        ],
      },
      1,
    )
  await assert.rejects(collectX(ctx, config), /重复/)
  ctx.sources.x.following = async () => {
    throw new Error('timeline unavailable')
  }
  await assert.rejects(collectX(ctx, config), /timeline unavailable/)
  assert.deepEqual(ctx.state, {})
})
test('X complete run filters merged candidates and only marks selected originals sent', async () => {
  const ctx = xContext()
  const result = await runX(ctx)
  assert.equal(result.message?.articles?.length, 1)
  assert.deepEqual(ctx.state, {})
  ctx.state = result.state
  assert.equal((await runX(ctx)).message?.articles?.length, 1)
})
const entry = (id: string): TiebaEntry => ({
  id,
  title: '漫画',
  body: '原文',
  replyCount: null,
  url: 'https://tieba.baidu.com/p/' + id,
})
const tiebaConfig: TiebaConfig = {
  globalFilter: '漫画，回帖超过20',
  forums: [{ name: '动画', filter: '' }],
  maxItems: 3,
  minScore: 75,
  includeImages: false,
}
function tiebaContext(): TiebaContext {
  return {
    config: {},
    state: {},
    now: new Date().toISOString(),
    ai: { respond: async () => call('plan_forum_searches', { queries: ['漫画', '动画'] }, 1) },
    sources: {
      tieba: {
        feed: async (input) => {
          assert.equal(input.pages, 2)
          return { mode: 'interests', entries: [entry('1')] }
        },
        search: async () => ({ mode: 'interests', entries: [entry('1'), entry('2')] }),
        post: async ({ id }) => ({ id, body: '完整首楼', replyCount: 25 }),
      },
    },
  }
}
test('Tieba preserves non-keyword feeds and hydrates search reply counts before filtering', async () => {
  const ctx = tiebaContext()
  let reads = 0
  ctx.sources.tieba.post = async ({ id }) => {
    reads++
    return { id, body: '首楼', replyCount: 25 }
  }
  const result = await collectTieba(ctx, tiebaConfig, tiebaConfig.forums[0])
  assert.deepEqual(
    result.entries.map((e) => e.id),
    ['1', '2'],
  )
  assert.equal(result.entries[1].replyCount, 25)
  assert.equal(reads, 1)
  ctx.config.useSearch = false
  assert.equal((await collectTieba(ctx, tiebaConfig, tiebaConfig.forums[0])).entries.length, 1)
  ctx.config.useSearch = true
  ctx.sources.tieba.search = async () => {
    throw new Error('search unavailable')
  }
  await assert.rejects(collectTieba(ctx, tiebaConfig, tiebaConfig.forums[0]), /search unavailable/)
})
test('Tieba search requests only threads by time and rejects cross-forum entries or broken schema', async () => {
  let invalid = false
  const tieba = new Tieba({
    fetch: async (url, options) => {
      assert.equal(url, 'https://tieba.baidu.com/c/s/searchpost')
      const form = new URLSearchParams(String(options.body))
      assert.equal(form.get('sm'), '1')
      assert.equal(form.get('only_thread'), '1')
      return testDouble({
        ok: true,
        json: async () =>
          invalid
            ? { error_code: '0' }
            : {
                error_code: '0',
                post_list: [
                  {
                    tid: '123',
                    fname: '动画',
                    title: '<em>动画</em>',
                    content: '摘要',
                    time: '1000',
                  },
                  { tid: '456', fname: '另一个吧' },
                ],
              },
      })
    },
  })
  const result = await tieba.search({ target: '动画', query: '漫画' })
  assert.equal(result.entries.length, 1)
  assert.equal(result.entries[0].createdAt, 1000000)
  assert.equal(result.entries[0].replyCount, null)
  invalid = true
  await assert.rejects(tieba.search({ target: '动画', query: '漫画' }), /格式/)
})
