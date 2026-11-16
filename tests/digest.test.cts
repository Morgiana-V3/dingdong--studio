import test from 'node:test'
import assert from 'node:assert/strict'
import { Engine } from '../src/engine.cjs'
import { digestPlugin, digestSources, DIGEST_ID } from '../src/digest.cjs'
import type { Task, PluginResult, Message } from '../src/types.cjs'
import { testDouble } from './helpers/fixtures.cjs'
import { dingdongDocument } from '../src/dingdong-document.cjs'
import { parseHTML } from 'linkedom'

function fixture(send: (message: Message) => Promise<void> = async () => {}) {
  const sources: Task[] = ['a', 'b'].map((id) => ({
    id,
    name: id,
    pluginId: 'example',
    channelId: 'phone',
    providerId: id + '-ai',
    schedule: { type: 'interval', minutes: 30 },
    enabled: false,
    onlyChanged: true,
    config: {},
    nextRun: null,
    pluginState: { seen: [] },
  }))
  const digest: Task = {
    ...sources[0],
    id: 'digest',
    name: '订阅汇总',
    pluginId: DIGEST_ID,
    config: { sourceTaskIds: 'a,b' },
    enabled: true,
    schedule: { type: 'interval', minutes: 60 },
  }
  const state = {
    tasks: [...sources, digest],
    history: [],
    channels: [{ id: 'phone', kind: 'dingdong' }],
  }
  const engine = new Engine(
    testDouble({ state, save() {}, redact: (value: string) => value }),
    testDouble({ list: () => [{ id: 'example' }, digestPlugin] }),
    testDouble({ send: async (_id: string, message: Message) => send(message) }),
    testDouble(null),
    () => {},
  )
  engine.execute = async (_plugin, task, controller): Promise<PluginResult> => {
    assert.equal(task.providerId, task.id + '-ai')
    controller.abort() // The real worker also aborts its own bridge when finished.
    return { message: { title: task.name, body: task.id }, state: { seen: [task.id] } }
  }
  return { engine, state, sources, digest }
}
test('digest collects configured sources once, sends once and commits all checkpoints after acceptance', async () => {
  let sent = 0
  const { engine, sources } = fixture(async (message) => {
    sent++
    assert.deepEqual(
      sources.map((source) => source.pluginState),
      [{ seen: [] }, { seen: [] }],
    )
    assert.deepEqual(
      message.sections?.map((section) => section.message.body),
      ['a', 'b'],
    )
  })
  const result = await engine.run('digest')
  assert.equal(result.status, 'sent')
  assert.equal(sent, 1)
  assert.deepEqual(
    sources.map((source) => source.pluginState),
    [{ seen: ['a'] }, { seen: ['b'] }],
  )
  assert.equal(engine.running.size, 0)
  assert.equal((await engine.run('digest')).status, 'skipped')
  assert.equal(sent, 1)
  await assert.rejects(engine.run('a'), /统一推送/)
})
test('send failure preserves every checkpoint even when another source already failed', async () => {
  for (const stage of ['source', 'delivery']) {
    let sends = 0
    const { engine, sources } = fixture(async () => {
      sends++
      throw new Error('relay offline')
    })
    const execute = engine.execute.bind(engine)
    if (stage === 'source') {
      engine.execute = async (plugin, task, controller) => {
        if (task.id === 'b') throw new Error('source offline')
        return execute(plugin, task, controller)
      }
    }
    assert.equal((await engine.run('digest')).status, 'failed')
    assert.deepEqual(
      sources.map((source) => source.pluginState),
      [{ seen: [] }, { seen: [] }],
    )
    assert.ok(sources.every((source) => !source.lastDigest))
    assert.equal(engine.running.size, 0)
    assert.equal(sends, 1)
  }
})
test('empty digest commits baselines without sending and source locks cancel the entire collection', async () => {
  const { engine, sources } = fixture(async () => {
    throw new Error('must not send')
  })
  engine.execute = async () => ({ message: null, state: { baseline: true } })
  assert.equal((await engine.run('digest')).status, 'skipped')
  assert.deepEqual(sources[0].pluginState, { baseline: true })
  engine.execute = async (_plugin, _task, controller) =>
    new Promise((_resolve, reject) =>
      controller.signal.addEventListener('abort', () => reject(new Error('cancelled')), {
        once: true,
      }),
    )
  const pending = engine.run('digest')
  assert.equal(engine.running.get('a'), engine.running.get('digest'))
  engine.running.get('b')!.abort()
  assert.equal((await pending).status, 'failed')
  assert.equal(engine.running.size, 0)
  assert.deepEqual(sources[0].pluginState, { baseline: true })
})
test('digest rejects nested, missing, busy and overlapping sources', async () => {
  const { engine, state, digest } = fixture()
  assert.throws(
    () => digestSources(state.tasks, { ...digest, config: { sourceTaskIds: 'digest' } }),
    /汇总任务/,
  )
  assert.throws(
    () => digestSources(state.tasks, { ...digest, config: { sourceTaskIds: 'missing' } }),
    /不存在/,
  )
  assert.throws(() => digestSources(state.tasks, { ...digest, id: 'other' }), /已由/)
  engine.running.set('a', new AbortController())
  assert.equal((await engine.run('digest')).status, 'failed')
  assert.equal(engine.running.size, 1)
})
test('merged HTML has one document, original article links, normalized custom content and no nested CSS', async () => {
  const result = await dingdongDocument({
    title: '汇总',
    body: '',
    sections: [
      {
        name: '贴吧',
        message: {
          title: '来源',
          body: '',
          articles: [
            {
              kind: 'tieba',
              title: '原帖',
              body: '楼主原文',
              url: 'https://tieba.baidu.com/p/123',
            },
          ],
        },
      },
      { name: '自定义', message: { title: '来源', body: '**加粗**\n\n正文' } },
      {
        name: 'HTML',
        message: {
          title: '来源',
          format: 'html',
          body: '<style>body{display:none}</style><p onclick="bad()" style="position:fixed">内容</p>',
        },
      },
    ],
  })
  const { document } = parseHTML(result.content)
  assert.equal(document.querySelectorAll('main > article').length, 3)
  assert.equal(document.querySelectorAll('.digest-section-title').length, 0)
  assert.equal(
    document.querySelector('h2 a')!.getAttribute('href'),
    'com.baidu.tieba://unidispatch/pb?tid=123',
  )
  assert.equal(document.querySelector('strong')!.textContent, '加粗')
  assert.doesNotMatch(result.content, /display:none|position:fixed|onclick/)
})
test('embedded emoticons use CSS instead of gallery images and cache repeated symbols', async () => {
  let downloads = 0
  const pixel =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII='
  const url = 'https://tb2.bdstatic.com/tb/editor/images/client/image_emoticon16.png'
  const result = await dingdongDocument(
    {
      title: '表情',
      body: '',
      articles: [
        {
          kind: 'tieba',
          title: '正文',
          body: '[阴险][阴险]',
          url: 'https://tieba.baidu.com/p/123',
          emoticons: [0, 4].map((offset) => ({ offset, length: 4, label: '[阴险]', url })),
        },
      ],
    },
    async () => {
      downloads++
      return pixel
    },
  )
  const { document } = parseHTML(result.content)
  assert.equal(document.querySelectorAll('img').length, 0)
  assert.equal(document.querySelectorAll('span.tieba-emoticon[role=img]').length, 2)
  assert.ok(document.querySelector('span.tieba-emoticon')!.getAttribute('style')!.includes(pixel))
  assert.equal(downloads, 1)
})

test('digest interleaves original cards by publication time and keeps undated cards last', async () => {
  const article = (title: string, publishedAt?: number) => ({
    kind: 'x' as const,
    title,
    body: title,
    url: 'https://x.com/i/status/123',
    publishedAt,
  })
  const message: Message = {
    title: '汇总',
    body: '',
    sections: [
      {
        name: '任务甲',
        message: {
          title: '甲',
          body: '',
          articles: [article('旧帖', 1000), article('新帖', 3000)],
        },
      },
      {
        name: '任务乙',
        message: { title: '乙', body: '', articles: [article('中间', 2000), article('无时间')] },
      },
    ],
  }
  const { document } = parseHTML((await dingdongDocument(message)).content)
  assert.deepEqual(
    [...document.querySelectorAll('h2 a')].map((node) => node.textContent),
    ['新帖', '中间', '旧帖', '无时间'],
  )
  assert.doesNotMatch(document.body.textContent!, /任务甲|任务乙/)
  assert.equal(document.querySelectorAll('.origin').length, 4)
  assert.equal(message.sections![0].message.articles![0].title, '旧帖')
})

test('failed first source does not block later sources; recovery sends only previously failed content', async () => {
  const delivered: Message[] = []
  const { engine, sources, digest } = fixture(async (message) => {
    delivered.push(message)
  })
  const execute = engine.execute.bind(engine)
  let failed = true
  engine.execute = async (plugin, task, controller) => {
    if (task.id === 'a' && failed) throw new Error('parser failed')
    return execute(plugin, task, controller)
  }
  const first = await engine.run(digest.id)
  assert.equal(first.status, 'partial')
  assert.deepEqual(first.sourceFailures, [{ taskId: 'a', name: 'a', detail: 'parser failed' }])
  assert.deepEqual(
    delivered[0].sections?.map((section) => section.name),
    ['b'],
  )
  assert.doesNotMatch(JSON.stringify(delivered[0]), /parser failed/)
  assert.deepEqual(sources[0].pluginState, { seen: [] })
  assert.deepEqual(sources[1].pluginState, { seen: ['b'] })
  assert.equal(sources[0].lastDigest, undefined)
  assert.ok(sources[1].lastDigest)
  failed = false
  const second = await engine.run(digest.id)
  assert.equal(second.status, 'sent')
  assert.deepEqual(
    delivered[1].sections?.map((section) => section.name),
    ['a'],
  )
  assert.equal(engine.running.size, 0)
})
test('partial run without new content commits only healthy baselines; all failed remains failed', async () => {
  const { engine, sources } = fixture(async () => {
    throw new Error('must not send')
  })
  engine.execute = async (_plugin, task) => {
    if (task.id === 'a') throw new Error('source offline')
    return { message: null, state: { baseline: true } }
  }
  const partial = await engine.run('digest')
  assert.equal(partial.status, 'partial')
  assert.match(partial.detail, /没有新内容/)
  assert.equal(partial.delivery, undefined)
  assert.deepEqual(sources[0].pluginState, { seen: [] })
  assert.deepEqual(sources[1].pluginState, { baseline: true })
  engine.execute = async () => {
    throw new Error('all offline')
  }
  const failed = await engine.run('digest')
  assert.equal(failed.status, 'failed')
  assert.equal(failed.sourceFailures?.length, 2)
  assert.equal(engine.running.size, 0)
})
