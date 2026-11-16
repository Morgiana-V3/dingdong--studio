import { modelResponse, type ModelOptions } from './helpers/tool-model.cjs'
import { testDouble } from './helpers/fixtures.cjs'
import type {
  TiebaEntry,
  TiebaState,
  TiebaContext,
  Trace,
  ToolRequest,
  TiebaConfig,
} from '../src/types.cjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  Tieba,
  parseTarget,
  normalizePage,
  signParameters,
  imageURL,
  normalizeFirstPost,
} from '../src/tieba.cjs'
import { run, preview, configValues, links, excerpt } from '../examples/tieba/index.cjs'
function thread(
  id = '101',
  time = 1000,
): NonNullable<Parameters<typeof normalizePage>[0]['thread_list']>[number] {
  return {
    id,
    title: '漫画讨论',
    create_time: time,
    author_id: '5',
    abstract: [{ type: 0, text: '人物成长与分镜讨论' }],
  }
}
function entry(id = '1', body = '剧情讨论'): TiebaEntry {
  return {
    id,
    title: '动画讨论 ' + id,
    body,
    createdAt: 1000000,
    images: ['https://tiebapic.baidu.com/a.jpg'],
    url: 'https://tieba.baidu.com/p/' + id,
  }
}
function context(state: TiebaState = {}, entries: TiebaEntry[] = [entry()], now = 10000000) {
  const ctx: TiebaContext & {
    config: TiebaConfig &
      Record<string, string | number | boolean | import('../src/types.cjs').Forum[] | undefined>
    trace: Trace[]
    calls: ToolRequest[]
    options: ModelOptions
  } = {
    ai: {
      respond: async () => {
        throw new Error('Mock not initialized')
      },
    },
    task: { id: 'fixture', name: '我的贴吧订阅' },
    config: {
      globalFilter: '梗文化、漫画讨论、动画讨论',
      useSearch: false,
      forums: [{ name: 'bilibili', filter: '' }],
      minScore: 75,
      maxItems: 3,
      includeImages: true,
    },
    state,
    now: new Date(now).toISOString(),
    trace: [],
    calls: [],
    options: {},
    sources: {
      tieba: {
        search: async () => ({ mode: 'interests', entries: [] }),
        feed: async () => ({ mode: 'interests', entries }),
        post: async ({ id }) => ({
          ...entry(id),
          body: '楼主原文：我的个人感受。',
          author: '楼主',
        }),
      },
    },
  }
  ctx.log = (event) => ctx.trace.push(event)
  ctx.ai = {
    respond: async (request) => {
      ctx.calls.push(structuredClone(request))
      return modelResponse(request, ctx.options)
    },
  }
  return ctx
}
test('public candidate collection mixes new and active orders without an age cutoff', async () => {
  const sorts: Array<string | null> = []
  const service = new Tieba({
    fetch: async (_url, options) => {
      assert.equal(options.credentials, 'omit')
      const form = new URLSearchParams(String(options.body))
      sorts.push(form.get('sort_type'))
      assert.equal(form.get('pn'), '1')
      const list =
        form.get('sort_type') === '1'
          ? [thread('1', 1000), thread('2', 900)]
          : [thread('1', 1000), thread('3', 10)]
      return { ok: true, status: 200, json: async () => ({ error_code: 0, thread_list: list }) }
    },
  })
  const result = await service.feed({ target: 'bilibili', mode: 'interests' })
  assert.deepEqual(sorts, ['1', '6'])
  assert.equal(result.entries.length, 3)
  assert.equal(result.entries.find((item) => item.id === '3')!.createdAt, 10000)
  assert.match(result.scopeDescription!, /不覆盖/)
  await assert.rejects(service.feed(testDouble({ target: 'bilibili', since: 0 })), /兴趣精选/)
})
test('candidate collection caps output and fails on source errors', async () => {
  const source = new Tieba({
    fetch: async (_url, options) => ({
      ok: true,
      status: 200,
      json: async () => ({
        error_code: 0,
        thread_list: Array.from({ length: 30 }, (_, i) =>
          thread(new URLSearchParams(String(options.body)).get('sort_type') + '00' + i),
        ),
      }),
    }),
  })
  assert.equal((await source.feed({ target: 'test', mode: 'interests' })).entries.length, 40)
  const failed = new Tieba({
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ error_code: 4 }) }),
  })
  await assert.rejects(failed.feed({ target: 'test', mode: 'interests' }), /拒绝/)
  assert.throws(() => normalizePage({}), /有效帖子/)
})
test('Tieba normalizes text, images and safe links', () => {
  assert.equal(parseTarget(' macmini ').name, 'macmini')
  assert.throws(() => parseTarget('https://example.com'), /吧名/)
  assert.equal(signParameters({ b: '2', a: '1' }), signParameters({ a: '1', b: '2' }))
  const item = thread()
  item.first_post_content = [
    { type: 0, text: '图前' },
    { type: 3, origin_src: 'http://tiebapic.baidu.com/a.jpg?token=keep' },
    { type: 0, text: '图后' },
  ]
  let result = normalizePage({ thread_list: [item] })[0]
  assert.equal(result.images![0], 'https://tiebapic.baidu.com/a.jpg?token=keep')
  assert.equal(result.body, '图前图后')
  item.first_post_content = []
  item.media = [
    { type: 3, origin_pic: 'javascript:bad', src_pic: 'https://imgsrc.baidu.com/a.jpg' },
  ]
  result = normalizePage({ thread_list: [item] })[0]
  assert.equal(result.body, '人物成长与分镜讨论')
  assert.equal(result.images![0], 'https://imgsrc.baidu.com/a.jpg')
  for (const url of [
    'file:///a.jpg',
    'data:image/png,hello',
    'https://user:pass@tiebapic.baidu.com/a',
    'https://tiebapic.baidu.com.evil.example/a',
    'https://tiebapic.baidu.com:8000/a',
  ]) {
    assert.equal(imageURL(url), null)
  }
  assert.equal(
    imageURL('https://tiebapic.baidu.com/a(1).jpg'),
    'https://tiebapic.baidu.com/a%281%29.jpg',
  )
})
test('first run formats content with linked title, quoted source and image only', async () => {
  const output = await run(context())
  assert.equal(output.message!.title, '我的贴吧订阅')
  assert.match(output.message!.body, /^## \[动画讨论 1\]\(com\.baidu\.tieba:/)
  assert.match(output.message!.body, /> bilibili吧/)
  assert.match(output.message!.body, /楼主原文：我的个人感受。/)
  assert.doesNotMatch(
    JSON.stringify(output.message),
    /为什么推荐|为你精选|条兴趣精选|网页备用|候选|仅依据|包含动画人物讨论|分享对角色成长的看法/,
  )
  assert.equal(
    links({ id: '2', title: '标题 [方括号]\n换行' }),
    '[标题 \\[方括号\\] 换行](com.baidu.tieba://unidispatch/pb?tid=2)',
  )
  assert.match(output.message!.body, /!\[帖子首图\]/)
  assert.match(output.message!.body, /com\.baidu\.tieba:\/\/unidispatch\/pb\?tid=1/)
  assert.doesNotMatch(output.message!.body, /https:\/\/tieba.baidu.com\/p\//)
  assert.equal(output.message!.short.includes('!['), false)
  assert.deepEqual(output.state.forums[0].state.sent, ['1'])
  assert.throws(() => links({ id: '1)evil', title: 'invalid' }), /编号/)
})

test('unsent candidates are reevaluated and reply count growth crosses the hard boundary', async () => {
  const entries = [{ ...entry('1'), replyCount: 20 }]
  const ctx = context({}, entries)
  ctx.options.conditions = [{ field: 'replyCount', operator: 'gt', value: 20 }]
  const first = await run(ctx)
  assert.equal(first.message, null)
  const later = context(first.state, [{ ...entry('1'), replyCount: 21 }])
  later.options = ctx.options
  assert((await run(later)).message)
  assert(later.calls.length >= 3)
})
test('sent IDs survive changed rules and legacy state without duplicate delivery', async () => {
  const first = await run(context())
  const ctx = context(first.state)
  ctx.config.forums[0].filter = '新的兴趣'
  ctx.ai.respond = async () => assert.fail('already delivered')
  assert.equal((await run(ctx)).message, null)
  const legacy = context({ version: 2, target: 'bilibili', sent: ['1'] })
  legacy.ai = ctx.ai
  assert.equal((await run(legacy)).message, null)
})
test('missing effective rules and unavailable AI fail without checkpoint mutation', async () => {
  const ctx = context()
  ctx.config.globalFilter = ''
  await assert.rejects(run(ctx), /过滤说明/)
  ctx.config.globalFilter = '动画'
  ctx.ai.respond = async () => {
    throw new Error('offline')
  }
  const before = JSON.stringify(ctx.state)
  await assert.rejects(run(ctx), /offline/)
  assert.equal(JSON.stringify(ctx.state), before)
})
test('preview does not mutate checkpoints, includes tool trace and respects image opt out', async () => {
  const ctx = context()
  ctx.config.includeImages = false
  const before = JSON.stringify(ctx.state)
  const result = await preview(ctx)
  assert.equal(result.selected.length, 1)
  assert.equal(result.message!.body.includes('!['), false)
  assert.equal(JSON.stringify(ctx.state), before)
  assert.equal(Object.hasOwn(result, 'state'), false)
  assert(ctx.trace.some((event) => event.tool === 'filter_candidates'))
})
function multi(state = {}) {
  const ctx = context(state)
  ctx.config = {
    includeImages: true,
    useSearch: false,
    globalFilter: '关注动画，排除广告',
    forums: [
      { name: '动画', filter: '' },
      { name: '硬件', filter: '本吧改为硬件评测' },
    ],
    maxItems: 1,
    minScore: 75,
  }
  ctx.sources.tieba.feed = async ({ target }) => ({
    mode: 'interests',
    entries: [entry(target === '动画' ? '10' : '20')],
  })
  return ctx
}
test('per-forum instructions remain isolated and global cap retains later eligible posts', async () => {
  const ctx = multi()
  const first = await run(ctx)
  assert.equal(first.state.forums[0].state.sent.length, 1)
  const initial = ctx.calls
    .filter((request) => request.input.length === 1)
    .map((request) => JSON.parse(request.input[0].content as string))
  assert.equal(initial.length, 2)
  assert.equal(initial[1].forumFilter, '本吧改为硬件评测')
  assert.equal(initial[1].globalFilter, '关注动画，排除广告')
  assert.match(ctx.calls[0].instructions, /本吧.*高于/)
  const second = await run(multi(first.state))
  assert.match(second.message!.body, /> 硬件吧/)
  assert.deepEqual(second.state.forums[1].state.sent, ['20'])
  assert.equal((await run(multi(second.state))).message, null)
})
test('unshipped previous selection is checked against current data before delivery', async () => {
  const ctx = multi()
  const first = await run(ctx)
  const second = multi(first.state)
  second.options.conditions = [{ field: 'replyCount', operator: 'gt', value: 20 }]
  assert.equal((await run(second)).message, null)
})
test('validates duplicate forums and independent rules', () => {
  const ctx = multi()
  ctx.config.forums.push({ name: '动画', filter: '' })
  assert.throws(() => configValues(ctx.config), /不重复/)
  ctx.config.forums = []
  assert.throws(() => configValues(ctx.config), /1–5/)
  ctx.config.forums = [{ name: '动画', filter: '漫画' }]
  ctx.config.globalFilter = ''
  assert.equal(configValues(ctx.config).forums[0].filter, '漫画')
})
test('first-floor extraction never substitutes replies and handles image-only posts', () => {
  const body = {
    thread: { id: '1', reply_num: 21 },
    user_list: [{ id: '7', name_show: '原作者' }],
    post_list: [
      { floor: 2, content: [{ type: 0, text: '回复' }] },
      {
        floor: 1,
        author_id: '7',
        content: [
          { type: 0, text: '第一段\n第二段' },
          { type: 3, origin_src: 'http://tiebapic.baidu.com/a.jpg' },
        ],
      },
    ],
  }
  const post = normalizeFirstPost(body, '1')
  assert.equal(post.body, '第一段\n第二段')
  assert.equal(post.replyCount, 21)
  assert.throws(() => normalizeFirstPost(body, '2'), /对应/)
  body.post_list[1].content = [{ type: 3, origin_src: 'https://tiebapic.baidu.com/a.jpg' }]
  assert.equal(normalizeFirstPost(body, '1').body, '')
  body.post_list.pop()
  assert.throws(() => normalizeFirstPost(body, '1'), /首楼/)
})
test('post bridge requests fixed endpoint and first page', async () => {
  const source = new Tieba({
    fetch: async (url, options) => {
      assert.equal(url, 'https://tieba.baidu.com/c/f/pb/page')
      const form = new URLSearchParams(String(options.body))
      assert.equal(form.get('kz'), '1')
      assert.equal(form.get('pn'), '1')
      assert.equal(options.credentials, 'omit')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          error_code: 0,
          thread: { id: '1' },
          post_list: [{ floor: 1, content: [{ type: 0, text: '首楼' }] }],
        }),
      }
    },
  })
  assert.equal((await source.post({ id: '1' })).body, '首楼')
  await assert.rejects(source.post({ id: 'https://example.com' }), /编号/)
})
test('original excerpt truncates long text and paragraphs without breaking unicode', () => {
  assert.deepEqual(excerpt({ body: '短内容' }), { text: '短内容', truncated: false })
  assert.equal([...excerpt({ body: '😀'.repeat(230) }).text].length, 221)
  assert.equal(excerpt({ body: '一\n二\n三\n四\n五' }).text, '一\n\n二\n\n三\n\n四…')
})
test('failed first-floor fetch preserves all prior state', async () => {
  const first = await run(multi())
  const next = multi(first.state)
  const before = JSON.stringify(next.state)
  next.sources.tieba.post = async () => {
    throw new Error('首楼读取失败')
  }
  await assert.rejects(run(next), /首楼读取失败/)
  assert.equal(JSON.stringify(next.state), before)
})
test('multiple posts keep task title, heading links and separators without author metadata', async () => {
  const ctx = multi()
  ctx.config.maxItems = 3
  const output = await run(ctx)
  assert.equal(output.message!.title, ctx.task!.name)
  assert.equal((output.message!.body.match(/^## \[/gm) || []).length, 2)
  assert.equal((output.message!.body.match(/^---$/gm) || []).length, 1)
  assert.doesNotMatch(output.message!.body, /> [^\n]* · |为什么推荐/)
})
test('normalizes reply counts without treating missing data as zero', () => {
  for (const [raw, expected] of [
    [0, 0],
    ['21', 21],
    [undefined, null],
    ['', null],
    [-1, null],
    ['bad', null],
  ]) {
    const post = { ...thread(), reply_num: raw }
    assert.equal(normalizePage({ thread_list: [post] })[0].replyCount, expected)
  }
})

test('first-floor emoticons preserve exact positions, descriptions and known image families', () => {
  const result = normalizeFirstPost(
    {
      thread: { id: '42' },
      post_list: [
        {
          floor: 1,
          content: [
            { type: 0, text: '😀前文\r\n' },
            { type: 2, text: 'image_emoticon16', c: '阴险' },
            { type: 0, text: '后文' },
            { type: 11, text: 'bearchildren_01', c: '熊孩子' },
            { type: 2, text: 'unknown_pack', c: '未知表情' },
            { type: 20, origin_src: 'https://tiebapic.baidu.com/sticker.jpg' },
            { type: 3, origin_src: 'https://imgsrc.baidu.com/photo.jpg' },
          ],
        },
      ],
    },
    '42',
  )
  assert.equal(result.body, '😀前文\n[阴险]后文[熊孩子][未知表情]')
  assert.equal(result.emoticons?.length, 2)
  for (const item of result.emoticons || []) {
    assert.equal(result.body.slice(item.offset, item.offset + item.length), item.label)
  }
  assert.match(result.emoticons![0].url, /client\/image_emoticon16.png$/)
  assert.match(result.emoticons![1].url, /bearchildren\/bearchildren_01.gif$/)
  assert.equal(result.images?.length, 2)
})

test('selected first-floor emoticons reach structured delivery without AI rewriting', async () => {
  const ctx = context()
  ctx.sources.tieba.post = async ({ id }) => ({
    id,
    body: '前[阴险]后',
    emoticons: [
      {
        offset: 1,
        length: 4,
        label: '[阴险]',
        url: 'https://tb2.bdstatic.com/tb/editor/images/client/image_emoticon16.png',
      },
    ],
  })
  const result = await run(ctx)
  assert.equal(result.message?.articles[0].emoticons?.[0].offset, 1)
  assert.equal(result.message?.articles[0].body, '前[阴险]后')
})
