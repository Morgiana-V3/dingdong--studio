import test from 'node:test'
import assert from 'node:assert/strict'
import type { XContext, XPost } from '../src/x-types.cjs'
import { normalizeXPost, parseXTimeline } from '../src/x-parser.cjs'
import { XSourceService } from '../src/x.cjs'
import { select, format, configValues } from '../examples/x/index.cjs'
import { xPost, xModel } from './helpers/x-fixtures.cjs'
import { call } from './helpers/tool-model.cjs'
import { testDouble } from './helpers/fixtures.cjs'
import type { Session, BrowserWindow } from 'electron'

const config = {
  accountId: '100',
  interests: '开源模型，回复超过 20',
  maxItems: 3,
  includeImages: true,
}
function context(posts: XPost[] = [xPost()]): XContext {
  return {
    config,
    state: {},
    now: new Date().toISOString(),
    task: { name: '我的 X 任务' },
    sources: {
      x: {
        following: async () => ({ posts: [], query: '', scope: '' }),
        search: async (input) => ({ posts, query: input.query, scope: '首批' }),
        detail: async ({ id }) => ({
          post: posts.find((post) => post.id === id)!,
          thread: [],
          scope: '片段',
        }),
      },
    },
    ai: { respond: async (request) => xModel(request) },
  }
}
function raw(id = '12345') {
  return {
    __typename: 'Tweet',
    rest_id: id,
    core: { user_results: { result: { rest_id: '100', core: { screen_name: 'fixture' } } } },
    legacy: {
      full_text: '原文 &amp; 内容',
      favorite_count: 25,
      reply_count: 21,
      retweet_count: 3,
      created_at: 'Sat Nov 14 10:00:00 +0000 2026',
      conversation_id_str: id,
      extended_entities: {
        media: [
          { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/test.jpg' },
          { type: 'photo', media_url_https: 'https://evil.test/image.jpg' },
          { type: 'video', media_url_https: 'https://pbs.twimg.com/media/video.jpg' },
        ],
      },
    },
  }
}
function timeline(entries: unknown[]) {
  return {
    data: {
      search_by_raw_query: { search_timeline: { timeline: { instructions: [{ entries }] } } },
    },
  }
}
function entry(tweet: unknown) {
  return { entryId: 'tweet-1', content: { itemContent: { tweet_results: { result: tweet } } } }
}
test('X parser reads notes, quotes, metrics and safe photos with both user formats', () => {
  const post = normalizeXPost({
    ...raw(),
    note_tweet: { note_tweet_results: { result: { text: '完整长文' } } },
    quoted_status_result: { result: raw('67890') },
  })!
  assert.equal(post.text, '完整长文')
  assert.equal(post.replyCount, 21)
  assert.deepEqual(post.images, ['https://pbs.twimg.com/media/test.jpg'])
  assert.equal(post.quoted?.id, '67890')
  const legacyUser = {
    ...raw(),
    core: { user_results: { result: { rest_id: '100', legacy: { screen_name: 'fixture' } } } },
  }
  assert.equal(
    normalizeXPost({ __typename: 'TweetWithVisibilityResults', tweet: legacyUser })?.text,
    '原文 & 内容',
  )
  assert.equal(
    normalizeXPost({ ...raw(), legacy: { ...raw().legacy, reply_count: '21' } })?.replyCount,
    null,
  )
  assert.equal(
    normalizeXPost({ ...raw(), legacy: { ...raw().legacy, retweeted_status_result: {} } }),
    null,
  )
})
test('X timeline excludes promotions and nested quotes, handles modules and fails on changed schema', () => {
  const posts = parseXTimeline(
    timeline([
      entry({ ...raw(), quoted_status_result: { result: raw('67890') } }),
      { ...entry(raw('2')), entryId: 'promoted-2' },
      { content: { itemContent: { promotedMetadata: {}, tweet_results: { result: raw('3') } } } },
      { content: { items: [{ item: { itemContent: { tweet_results: { result: raw('4') } } } }] } },
    ]),
    'search',
  )
  assert.deepEqual(
    posts.map((post) => post.id),
    ['12345', '4'],
  )
  assert.deepEqual(parseXTimeline(timeline([]), 'search'), [])
  assert.throws(
    () => parseXTimeline({ errors: [{ message: 'rate limited' }] }, 'search'),
    /读取错误/,
  )
  assert.throws(() => parseXTimeline({ data: {} }, 'search'), /格式已变化/)
  assert.equal(
    parseXTimeline(
      {
        data: {
          threaded_conversation_with_injections_v2: { instructions: [{ entries: [entry(raw())] }] },
        },
      },
      'detail',
    ).length,
    1,
  )
})
test('X agent previews original content, enforces >20 boundary and preserves state', async () => {
  const ctx = context([
    xPost(),
    xPost({ id: '2', replyCount: 20 }),
    xPost({ id: '3', replyCount: null }),
  ])
  ctx.state = { accountId: '100', sent: ['12345'] }
  const result = await select({ ...ctx, state: {} })
  assert.deepEqual(
    result.selected.map((post) => post.id),
    ['12345'],
  )
  assert.equal(result.message?.title, '我的 X 任务')
  assert.match(result.message!.body, /^## \[/)
  assert.match(result.message!.body, /开源模型发布/)
  assert.doesNotMatch(result.message!.body, /推荐理由|为你精选|评分/)
  assert.deepEqual(ctx.state.sent, ['12345'])
  assert.equal((await select(ctx)).message, null)
  ctx.state.accountId = '200'
  assert.ok((await select(ctx)).message)
})
test('X agent keeps hard constraints after more searches and refreshed detail', async () => {
  const ctx = context([xPost()])
  let round = 0
  ctx.ai.respond = async () => {
    const steps = [
      call('search_posts', { query: 'AI', sort: 'Latest' }, 1),
      call(
        'filter_posts',
        { conditions: [{ field: 'replyCount', operator: 'gt', value: 20 }], match: 'all' },
        2,
      ),
      call('search_posts', { query: 'models', sort: 'Top' }, 3),
      call(
        'submit_selection',
        { selected: [{ id: '12345', score: 90 }], unavailableReason: '' },
        4,
      ),
      call('submit_selection', { selected: [], unavailableReason: '' }, 5),
    ]
    return steps[round++]
  }
  let searches = 0
  ctx.sources.x.search = async ({ query }) => ({
    posts: [xPost({ replyCount: ++searches === 1 ? 25 : 20 })],
    query,
    scope: '',
  })
  assert.equal((await select(ctx)).message, null)
  const refreshed = context()
  refreshed.sources.x.detail = async () => ({
    post: xPost({ replyCount: 0 }),
    thread: [],
    scope: '',
  })
  await assert.rejects(select(refreshed), /8 轮/)
})
test('X rejects fabricated IDs, invalid scores and repeated calls instead of sending', async () => {
  for (const selected of [[{ id: '99999', score: 90 }], [{ id: '12345', score: 74 }]]) {
    const ctx = context()
    let count = 0
    ctx.ai.respond = async (request) => {
      if (++count < 3) {
        return xModel(request)
      }
      return call('submit_selection', { selected, unavailableReason: '' }, count)
    }
    await assert.rejects(select(ctx), /8 轮/)
  }
  const ctx = context()
  ctx.ai.respond = async () => call('search_posts', { query: 'AI', sort: 'Top' }, 1)
  await assert.rejects(select(ctx), /重复/)
})
test('X read failures, capability gaps and search budget errors do not advance delivery state', async () => {
  const ctx = context()
  ctx.state = { accountId: '100', sent: ['old'] }
  ctx.sources.x.search = async () => {
    throw new Error('X 限流')
  }
  await assert.rejects(select(ctx), /限流/)
  assert.deepEqual(ctx.state.sent, ['old'])
  const unavailable = context()
  let n = 0
  unavailable.ai.respond = async (request) =>
    ++n < 3
      ? xModel(request)
      : call('submit_selection', { selected: [], unavailableReason: '无法观看视频' }, n)
  await assert.rejects(select(unavailable), /无法观看视频/)
  const budget = context()
  let index = 0
  budget.ai.respond = async () => call('search_posts', { query: 'AI', sort: 'Latest' }, ++index)
  await assert.rejects(select(budget), /最多搜索 3 次/)
})
test('X formatting uses task name, linked headings, separators, original excerpt and safe media', () => {
  const result = format(
    [
      xPost({
        text: '长文\n' + '文'.repeat(700),
        images: ['https://pbs.twimg.com/media/test.jpg'],
      }),
      xPost({ id: '2', text: '<script> [说明]', images: ['https://evil.test/image.jpg'] }),
    ],
    config,
    '任务',
  )!
  assert.equal(result.title, '任务')
  assert.match(result.body, /\n\n---\n\n/)
  assert.match(result.body, /> 正文已节选/)
  assert.doesNotMatch(result.body, /evil.test|<script>/)
  assert.match(result.body, /!\[原帖配图\]/)
  assert.doesNotMatch(
    format([xPost({ images: ['https://pbs.twimg.com/media/test.jpg'] })], {
      ...config,
      includeImages: false,
    })!.body,
    /!\[/,
  )
  assert.throws(() => configValues({ ...config, maxItems: 9 }), /1–5/)
})
test('X message links retain the exact large ID and never trust a supplied URL', () => {
  const post = xPost({
    id: '2120694045299327187',
    username: 'with_underscore',
    url: 'https://invalid.test/wrong',
    text: '开源游戏工具更新\n\n支持新的场景和动作。',
  })
  const result = format([post], config)!
  assert.match(result.body, /\]\(twitter:\/\/status\?id=2120694045299327187\)/)
  assert.match(
    result.body,
    /\[网页查看\]\(https:\/\/x.com\/with_underscore\/status\/2120694045299327187\)/,
  )
  assert.doesNotMatch(result.body, /invalid.test/)
  assert.equal(result.body.split('开源游戏工具更新').length - 1, 1)
  assert.match(result.body, /支持新的场景和动作/)
  assert.throws(() => format([xPost({ id: '123)\n[bad]' })], config), /链接信息/)
})
test('X parser resolves known external links and removes photo placeholders without dropping video or unknown links', () => {
  const post = normalizeXPost({
    ...raw(),
    legacy: {
      ...raw().legacy,
      full_text:
        '项目 https://t.co/project 图 https://t.co/photo 视频 https://t.co/video 未知 https://t.co/unknown',
      entities: {
        urls: [{ url: 'https://t.co/project', expanded_url: 'https://github.com/example/tool' }],
      },
      extended_entities: {
        media: [
          {
            type: 'photo',
            url: 'https://t.co/photo',
            media_url_https: 'https://pbs.twimg.com/media/test.jpg',
          },
          { type: 'video', url: 'https://t.co/video' },
        ],
      },
    },
  })!
  assert.match(post.text, /https:\/\/github.com\/example\/tool/)
  assert.doesNotMatch(post.text, /t.co\/photo/)
  assert.match(post.text, /t.co\/video/)
  assert.match(post.text, /t.co\/unknown/)
  const message = format([post], config)!
  assert.match(message.body, /\[github.com\]\(https:\/\/github.com\/example\/tool\)/)
})
function memoryCredentials(): import('../src/x-credentials.cjs').XCredentialStore {
  let cookies = [
    { name: 'auth_token', value: 'fixture' },
    { name: 'ct0', value: 'csrf' },
    { name: 'twid', value: 'u=100' },
  ]
  return {
    load: () => cookies,
    save: (input) => {
      cookies = input
    },
    clear: () => {
      cookies = []
    },
  }
}

test('X source checks account isolation and input before creating a browser window', async () => {
  const session = testDouble<Session>({
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {},
    on() {},
    cookies: {
      get: async () => [
        { name: 'auth_token', value: 'fixture' },
        { name: 'twid', value: 'u%3D100' },
      ],
    },
  })
  const source = new XSourceService(
    session,
    testDouble<typeof BrowserWindow>(
      class {
        constructor() {
          throw new Error('unexpected browser')
        }
      },
    ),
    undefined,
    {
      request: async () => {
        throw new Error('unexpected HTTP')
      },
      stop() {},
    },
    memoryCredentials(),
  )
  assert.deepEqual(await source.account(), { hasSession: true, id: '100' })
  await assert.rejects(source.search({ accountId: '200', query: 'AI', sort: 'Latest' }), /账号不同/)
  await assert.rejects(source.search({ accountId: '100', query: '', sort: 'Latest' }), /搜索词/)
  await assert.rejects(source.detail({ accountId: '100', id: '../bad' }), /编号无效/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    source.search({ accountId: '100', query: 'AI', sort: 'Latest' }, controller.signal),
    /abort/i,
  )
})

test('X source uses the HTTP transport with saved credentials, never a browser', async () => {
  const session = testDouble<Session>({
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {},
    on() {},
  })
  const calls: string[] = []
  const credentials = memoryCredentials()
  const http: import('../src/x-http.cjs').XHTTPTransport = {
    request: async (operation, variables, cookies) => {
      calls.push(operation)
      assert.equal(variables.rawQuery, 'AI')
      assert.equal(cookies.length, 3)
      return timeline([entry(raw())])
    },
    stop() {},
  }
  const chrome = testDouble<import('../src/x-chrome.cjs').XChrome>({
    cookies: () => {
      throw new Error('browser opened')
    },
  })
  const service = new XSourceService(
    session,
    testDouble<typeof BrowserWindow>(
      class {
        constructor() {
          throw new Error('window opened')
        }
      },
    ),
    chrome,
    http,
    credentials,
  )
  assert.equal((await service.account()).id, '100')
  assert.equal(
    (await service.search({ accountId: '100', query: 'AI', sort: 'Latest' })).posts.length,
    1,
  )
  await assert.rejects(
    service.search({ accountId: '200', query: 'AI', sort: 'Latest' }),
    /账号不同/,
  )
  assert.deepEqual(calls, ['SearchTimeline'])
})

test('quote-only posts remain valid after redundant quote links are removed', () => {
  const original = raw('111')
  const quote = raw('222')
  const result = {
    ...original,
    quoted_status_result: { result: quote },
    legacy: {
      ...original.legacy,
      full_text: 'https://t.co/quote',
      extended_entities: { media: [] },
      entities: {
        urls: [{ url: 'https://t.co/quote', expanded_url: 'https://x.com/fixture/status/222' }],
      },
    },
  }
  const parsed = parseXTimeline(timeline([entry(result)]), 'search')
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].text, '')
  assert.equal(parsed[0].quoted?.text, '原文 & 内容')
  assert.match(format(parsed, config)!.body, /引用原文/)
})
