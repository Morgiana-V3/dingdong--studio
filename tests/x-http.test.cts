import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { XHTTPClient, parseMetadata } from '../src/x-http-client.cjs'
import { XHTTP, httpProxy } from '../src/x-http.cjs'
import { XCredentials, validateXCookies } from '../src/x-credentials.cjs'
import { testDouble } from './helpers/fixtures.cjs'
import type { utilityProcess } from 'electron'

const cookies = [
  { name: 'auth_token', value: 'private-token' },
  { name: 'ct0', value: 'private-csrf' },
  { name: 'twid', value: 'u=100' },
]
function metadata(id = 'abcdefghijk123') {
  return {
    graphql: Object.fromEntries(
      ['SearchTimeline', 'TweetDetail', 'HomeLatestTimeline'].map((name) => [
        name,
        {
          queryId: id,
          url: 'https://untrusted.example',
          method: 'GET',
          features: { valid_flag: true },
        },
      ]),
    ),
  }
}
const signer = async () => ({ generateTransactionId: async () => 'signature' })
test('direct HTTP sends credentials only to fixed X endpoint and reuses metadata/signing', async () => {
  const requests: Array<{ url: URL; options: RequestInit }> = []
  const fetcher: typeof fetch = async (input, options = {}) => {
    const url = new URL(String(input))
    requests.push({ url, options })
    if (url.hostname === 'raw.githubusercontent.com') {
      return Response.json(metadata())
    }
    return Response.json({ data: { result: 'ok' } })
  }
  const client = new XHTTPClient(undefined, { fetcher, createSigner: signer })
  await client.request('SearchTimeline', { rawQuery: 'AI & tools', count: 30 }, cookies)
  await client.request('TweetDetail', { focalTweetId: '12345' }, cookies)
  assert.equal(requests.length, 3)
  assert.equal(new Headers(requests[0].options.headers).has('cookie'), false)
  assert.equal(requests[1].url.origin, 'https://x.com')
  assert.match(requests[1].url.pathname, /^\/i\/api\/graphql\/abcdefghijk123\/SearchTimeline$/)
  assert.equal(JSON.parse(requests[1].url.searchParams.get('variables')!).rawQuery, 'AI & tools')
  assert.match(new Headers(requests[1].options.headers).get('cookie')!, /auth_token=private-token/)
  assert.equal(requests[1].options.redirect, 'error')
  assert.equal(requests[2].url.pathname.endsWith('/TweetDetail'), true)
})
test('changed query ID refreshes once; rate limits and login errors never retry or launch a browser', async () => {
  let count = 0
  let metadataCount = 0
  const client = new XHTTPClient(undefined, {
    createSigner: signer,
    fetcher: async (url) => {
      if (String(url).includes('raw.githubusercontent.com')) {
        metadataCount++
        return Response.json(metadata('updatedquery' + metadataCount))
      }
      return ++count === 1 ? new Response('', { status: 404 }) : Response.json({ data: {} })
    },
  })
  await client.request('SearchTimeline', {}, cookies)
  assert.equal(count, 2)
  assert.equal(metadataCount, 2)
  for (const [status, expected] of [
    [429, /限流/],
    [401, /失效/],
    [403, /验证/],
  ] as const) {
    let calls = 0
    const failing = new XHTTPClient(undefined, {
      createSigner: signer,
      fetcher: async (url) => {
        if (String(url).includes('raw.githubusercontent.com')) {
          return Response.json(metadata())
        }
        calls++
        return new Response('', { status })
      },
    })
    await assert.rejects(failing.request('SearchTimeline', {}, cookies), expected)
    assert.equal(calls, 1)
  }
})
test('malformed metadata, GraphQL auth error and oversized responses fail explicitly', async () => {
  assert.throws(() => parseMetadata({ graphql: { SearchTimeline: { queryId: '../bad' } } }), /格式/)
  const client = new XHTTPClient(undefined, {
    createSigner: signer,
    fetcher: async (url) =>
      String(url).includes('raw.githubusercontent.com')
        ? Response.json(metadata())
        : Response.json({ errors: [{ code: 89, message: 'SECRET must not surface' }] }),
  })
  await assert.rejects(
    client.request('SearchTimeline', {}, cookies),
    (error: Error) => /失效/.test(error.message) && !error.message.includes('SECRET'),
  )
  const large = new XHTTPClient(undefined, {
    createSigner: signer,
    fetcher: async (url) =>
      String(url).includes('raw.githubusercontent.com')
        ? Response.json(metadata())
        : new Response(' '.repeat(8_000_001)),
  })
  await assert.rejects(large.request('SearchTimeline', {}, cookies), /过大/)
})
test('encrypted X credentials survive restart, omit unrelated cookies, clear and reject damaged storage', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'minipush-x-credentials-'))
  // Exercise persistence boundaries with a reversible test codec; production uses safeStorage.
  const codec = {
    encrypt: (value: string) => Buffer.from(value).toString('base64'),
    decrypt: (value: string | undefined) => Buffer.from(value || '', 'base64').toString(),
  }
  try {
    const store = new XCredentials(directory, codec)
    assert.deepEqual(store.load(), [])
    store.save([...cookies, { name: 'unrelated', value: 'discard' }])
    assert.deepEqual(new XCredentials(directory, codec).load(), cookies)
    const filename = path.join(directory, 'x-session.encrypted.json')
    assert.doesNotMatch(fs.readFileSync(filename, 'utf8'), /private-token|private-csrf/)
    // Windows does not implement POSIX group/other permission bits.
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(filename).mode & 0o777, 0o600)
    }
    assert.throws(() => validateXCookies([{ name: 'auth_token', value: 'bad\nvalue' }]), /不完整/)
    fs.writeFileSync(filename, '{}')
    assert.throws(() => store.load(), /解密/)
    store.clear()
    assert.deepEqual(store.load(), [])
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
test('HTTP worker cancellation kills the request process and permits the next job', async () => {
  const children: Array<EventEmitter & { killed: boolean }> = []
  const utility = testDouble<typeof utilityProcess>({
    fork() {
      const child = Object.assign(new EventEmitter(), {
        killed: false,
        kill() {
          this.killed = true
        },
        postMessage() {},
      })
      children.push(child)
      return child
    },
  })
  const transport = new XHTTP('/tmp', utility, async () => 'DIRECT')
  const controller = new AbortController()
  const pending = transport.request('SearchTimeline', {}, cookies, controller.signal)
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()
  await assert.rejects(pending, /取消/)
  assert.equal(children[0].killed, true)
  const next = transport.request('TweetDetail', {}, cookies, new AbortController().signal)
  await new Promise((resolve) => setImmediate(resolve))
  children[1].emit('message', { id: 2, value: { ok: true } })
  assert.deepEqual(await next, { ok: true })
  transport.stop()
  assert.equal(httpProxy('PROXY 127.0.0.1:1087; DIRECT'), 'http://127.0.0.1:1087')
  assert.equal(httpProxy('DIRECT'), '')
  assert.throws(() => httpProxy('SOCKS5 localhost:1080'), /代理类型/)
})
