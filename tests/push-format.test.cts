import { serviceStore } from './helpers/fixtures.cjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Services } from '../src/services.cjs'
test('ServerChan JSON preserves Markdown image and separate card summary', async () => {
  let payload: { title: string; desp: string; short: string } | undefined
  const services = new Services(
    serviceStore({
      channels: [{ id: 'phone', kind: 'sc3', secret: 'encrypted' }],
      key: 'sctp123ttest',
    }),
    async (_url, options) => {
      assert.equal(new Headers(options.headers).get('Content-Type'), 'application/json')
      payload = JSON.parse(String(options.body))
      return { ok: true, status: 200, json: async () => ({ code: 0 }) }
    },
  )
  const message = {
    title: '图文新帖',
    body: '### 标题\n\n![帖子首图](https://tiebapic.baidu.com/a.jpg)\n\n[原帖](https://tieba.baidu.com/p/1)',
    short: '1 条新帖 · 标题',
  }
  await services.send('phone', message)
  assert.ok(payload)
  assert.equal(payload.desp, message.body)
  assert.equal(payload.short, message.short)
  assert.equal(payload.title, message.title)
})
