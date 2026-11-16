import { testDouble } from './helpers/fixtures.cjs'
import type { Video } from '../src/types.cjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Bilibili, normalizeVideo } from '../src/bilibili.cjs'
import { run } from '../examples/bilibili/index.cjs'

function videoItem(id = 'BVtest1', timestamp = 1000) {
  return {
    type: 'DYNAMIC_TYPE_AV',
    modules: {
      module_author: { mid: 2, name: '测试 UP', pub_ts: timestamp },
      module_dynamic: { major: { archive: { bvid: id, title: '新视频', desc: '视频简介' } } },
    },
  }
}
function service(respond: (url: URL) => unknown) {
  return new Bilibili(
    testDouble<ConstructorParameters<typeof Bilibili>[0]>({
      fetch: async (url: string, options: RequestInit) => {
        assert.equal(options.credentials, 'include')
        assert.equal(new URL(url).hostname, 'api.bilibili.com')
        return { ok: true, json: async () => respond(new URL(url)) }
      },
    }),
    testDouble<ConstructorParameters<typeof Bilibili>[1]>(null),
  )
}
const account = { code: 0, data: { isLogin: true, mid: 1, uname: '测试用户' } }

test('Bilibili normalizes video-only data and derives safe links', () => {
  assert.equal(normalizeVideo(videoItem())!.url, 'https://www.bilibili.com/video/BVtest1')
  assert.equal(normalizeVideo({ type: 'DYNAMIC_TYPE_FORWARD' }), null)
  assert.equal(normalizeVideo(videoItem('https://example.com')), null)
})
test('Bilibili rejects expired or mismatched accounts and does not fetch their feed', async () => {
  const expired = service(() => ({ code: -101 }))
  assert.deepEqual(await expired.account(), { loggedIn: false })
  await assert.rejects(expired.feed({ accountMid: '1', since: 0 }), /先.*登录/)
  const other = service((url) => {
    assert.equal(url.pathname, '/x/web-interface/nav')
    return account
  })
  await assert.rejects(other.feed({ accountMid: '999', since: 0 }), /账号不同/)
})
test('Bilibili followings paginates the authenticated account', async () => {
  const client = service((url) => {
    if (url.pathname.endsWith('/nav')) {
      return account
    }
    assert.equal(url.searchParams.get('vmid'), '1')
    assert.equal(url.searchParams.get('pn'), '2')
    return {
      code: 0,
      data: {
        total: 101,
        list: Array.from({ length: 50 }, (_, index) => ({ mid: index + 51, uname: 'UP' })),
      },
    }
  })
  const response = await client.followings({ accountMid: '1', page: 2 })
  assert.equal(response.hasMore, true)
  assert.equal(response.users.length, 50)
})
test('Bilibili stops at the time boundary and rejects truncated regular scans', async () => {
  let pages = 0
  const client = service((url) => {
    if (url.pathname.endsWith('/nav')) {
      return account
    }
    pages++
    return {
      code: 0,
      data: {
        items: [videoItem('BVtest' + pages, 1000 - pages * 100)],
        has_more: true,
        offset: String(pages),
      },
    }
  })
  const response = await client.feed({ accountMid: '1', since: 850000 })
  assert.equal(response.videos.length, 1)
  assert.equal(pages, 2)
  pages = 0
  await assert.rejects(client.feed({ accountMid: '1', since: 0 }), /超过 5 页/)
})

function context(
  state: Parameters<typeof run>[0]['state'] = {},
  videos: Video[] = [],
  now = 1000000,
): Parameters<typeof run>[0] {
  return {
    ai: { generate: async () => 'test' },
    config: { accountMid: '1', upIds: '2', maxItems: 1, keywords: '', useAI: false },
    state,
    now: new Date(now).toISOString(),
    sources: { bilibili: { feed: async () => ({ videos, complete: true }) } },
  }
}
function video(id: string, publishedAt = 1001000) {
  return {
    id,
    authorId: '2',
    author: 'UP',
    title: '视频 ' + id,
    description: '正文',
    publishedAt,
    url: 'https://www.bilibili.com/video/' + id,
  }
}
test('first run creates a baseline; later runs batch without dropping pending videos or duplicating', async () => {
  const baseline = await run(context({}, [video('BVold', 900000)]))
  assert.equal(baseline.message, null)
  assert.match(baseline.detail!, /基线/)
  const next = await run(context(baseline.state, [video('BV1'), video('BV2')], 1002000))
  assert.match(next.message!.body, /BV1/)
  assert.equal(next.state.pending.length, 1)
  const rest = await run(context(next.state, [video('BV1'), video('BV2')], 1003000))
  assert.match(rest.message!.body, /BV2/)
  assert.equal(rest.state.pending.length, 0)
  const duplicate = await run(context(rest.state, [video('BV1'), video('BV2')], 1004000))
  assert.equal(duplicate.message, null)
})
test('subscription scope changes reset baseline; keyword filtering precedes AI', async () => {
  const baseline = await run(context())
  const changed = context(baseline.state, [video('BV1')], 1002000)
  changed.config.upIds = '3'
  assert.equal((await run(changed)).message, null)
  const filtered = context()
  filtered.config.keywords = 'AI'
  filtered.config.useAI = true
  filtered.ai = { generate: () => assert.fail('no AI call for unmatched content') }
  filtered.state = (await run(filtered)).state
  filtered.sources.bilibili.feed = async () => ({ videos: [video('BV1')], complete: true })
  filtered.now = new Date(1002000).toISOString()
  assert.equal((await run(filtered)).message, null)
})
