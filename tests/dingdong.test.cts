import test from 'node:test'
import assert from 'node:assert/strict'
import { channelConnection, relayAddress } from '../src/channels.cjs'
import { dingdongDocument } from '../src/dingdong-document.cjs'
import { sendDingdong, deliveryStatus } from '../src/dingdong.cjs'
import type { Channel, Fetcher } from '../src/types.cjs'

const channel: Channel = {
  id: 'phone',
  name: '叮咚手机',
  kind: 'dingdong',
  baseUrl: 'https://relay.example',
  source: 'MiniPush',
  silent: true,
}
const key = 'test-send-token-'.repeat(3)
const message = {
  title: '图文消息',
  body: '## [原帖](twitter://status?id=2120694045299327187)\n\n![图](https://images.example/photo.png)\n\n[贴吧](com.baidu.tieba://unidispatch/pb?tid=12345)',
  short: '正文摘要',
}
const pixel =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII='

test('Dingdong addresses and credentials reject changed destinations without a new key', () => {
  assert.equal(relayAddress('127.0.0.1:8080/'), 'http://127.0.0.1:8080')
  assert.equal(relayAddress('https://relay.example/push/'), 'https://relay.example/push')
  for (const address of [
    'file:///tmp/a',
    'https://user:pass@relay.example',
    'https://relay.example/?key=secret',
  ]) {
    assert.throws(() => relayAddress(address))
  }
  assert.equal(channelConnection({ ...channel, key: '' }, channel, () => key).key, key)
  assert.throws(
    () =>
      channelConnection({ ...channel, baseUrl: 'https://different.example' }, channel, () => key),
    /重新填写/,
  )
  assert.throws(() => channelConnection({ ...channel, key: 'short' }, undefined, () => key), /32/)
})
test('Dingdong document embeds images, adapts app links, preserves HTML CSS and removes active content', async () => {
  const rendered = await dingdongDocument(message, async () => pixel)
  assert.match(rendered.content, /src="data:image\/png;base64,/)
  assert.match(rendered.content, /href="https:\/\/x.com\/i\/status\/2120694045299327187"/)
  assert.match(rendered.content, /href="com.baidu.tieba:\/\/unidispatch\/pb\?tid=12345"/)
  assert.doesNotMatch(rendered.content, /twitter:\/\//)
  const custom = await dingdongDocument({
    title: '自定义',
    format: 'html',
    body: '<style>p{color:red}</style><p onclick="evil()">正文</p><script>evil()</script><a href="javascript:evil()">坏链接</a>',
  })
  assert.match(custom.content, /p\{color:red\}/)
  assert.doesNotMatch(custom.content, /onclick|<script|javascript:/)
  const missing = await dingdongDocument(message, async () => {
    throw new Error('offline')
  })
  assert.equal(missing.omitted, 1)
  assert.match(missing.content, /配图未附入/)
  await assert.rejects(dingdongDocument({ title: '大文档', body: '文'.repeat(400000) }), /1 MB/)
})
test('Dingdong retries use identical IDs and bytes, preserve queued versus received, and do not redirect credentials', async () => {
  const payloads: string[] = []
  let images = 0
  const fetcher: Fetcher = async (url, options) => {
    assert.equal(url, 'https://relay.example/v1/messages')
    assert.equal(options.redirect, 'error')
    assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${key}`)
    payloads.push(String(options.body))
    if (payloads.length === 1) {
      throw new Error('connection lost after upload')
    }
    const payload = JSON.parse(String(options.body))
    assert.equal(payload.id, 'stable-id')
    assert.equal(payload.priority, 'silent')
    assert.equal(payload.summary, message.short)
    assert.equal(payload.format, 'html')
    assert.equal(payload.source, 'MiniPush')
    assert.match(payload.content, /data:image\/png;base64,/)
    return { ok: true, status: 202, json: async () => ({ id: payload.id, status: 'queued' }) }
  }
  let status = ''
  const detail = await sendDingdong(
    fetcher,
    channel,
    key,
    message,
    async () => {
      images++
      return pixel
    },
    undefined,
    {
      id: 'stable-id',
      onStatus: (value) => {
        status = value
      },
    },
  )
  assert.equal(payloads.length, 2)
  assert.equal(payloads[0], payloads[1])
  assert.equal(images, 1)
  assert.equal(status, 'queued')
  assert.match(detail, /等待手机/)
  assert.equal(
    await deliveryStatus(
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: 'stable-id', status: 'received' }),
      }),
      channel,
      key,
      'stable-id',
    ),
    'received',
  )
})
test('Dingdong auth rejection, malformed response and mismatched receipt cannot become success', async () => {
  let attempts = 0
  await assert.rejects(
    sendDingdong(
      async () => {
        attempts++
        return { ok: false, status: 401, json: async () => ({}) }
      },
      channel,
      key,
      { title: 't', body: 'b' },
    ),
    /发送密钥/,
  )
  assert.equal(attempts, 1)
  await assert.rejects(
    sendDingdong(
      async () => ({ ok: true, status: 200, json: async () => ({ code: 0 }) }),
      channel,
      key,
      { title: 't', body: 'b' },
    ),
    /格式/,
  )
  await assert.rejects(
    deliveryStatus(
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: 'wrong', status: 'received' }),
      }),
      channel,
      key,
      'right',
    ),
    /不匹配/,
  )
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    sendDingdong(
      async () => {
        throw new Error('must not send')
      },
      channel,
      key,
      message,
      undefined,
      controller.signal,
    ),
    /abort/i,
  )
})

test('Tieba deep links remain app links with exact large IDs and reject foreign routes', async () => {
  const { compatibleLink } = await import('../src/dingdong-document.cjs')
  assert.equal(
    compatibleLink('com.baidu.tieba://unidispatch/pb?tid=11202394386'),
    'com.baidu.tieba://unidispatch/pb?tid=11202394386',
  )
  for (const address of [
    'com.baidu.tieba://unidispatch/delete?tid=1',
    'com.baidu.tieba://user@unidispatch/pb?tid=1',
    'com.baidu.tieba://unidispatch/pb?tid=no',
    'javascript:alert(1)',
    'intent://unidispatch/pb?tid=1',
  ]) {
    assert.equal(compatibleLink(address), undefined)
  }
})
