import { serviceStore } from './helpers/fixtures.cjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Services } from '../src/services.cjs'
const store = serviceStore({
  providers: [{ id: 'saved', baseUrl: 'https://api.openai.com/v1', secret: 'encrypted' }],
  key: 'saved-key',
})

test('models uses saved credentials only at the saved endpoint and returns all unique model IDs', async () => {
  const services = new Services(store, async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/models')
    assert.equal(options.method, 'GET')
    assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer saved-key')
    assert.equal(options.redirect, 'error')
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ id: 'gpt-test' }, { id: 'image-test' }, { id: 'gpt-test' }, {}, null],
      }),
    }
  })
  assert.deepEqual(
    await services.listModels({ id: 'saved', baseUrl: 'https://api.openai.com/v1/' }),
    ['gpt-test', 'image-test'],
  )
})

test('changed endpoints require an explicit key before any request', async () => {
  const services = new Services(store, () => assert.fail('must not send credentials'))
  await assert.rejects(
    services.listModels({ id: 'saved', baseUrl: 'https://example.com/v1' }),
    /重新填写/,
  )
  await assert.rejects(
    services.listModels({ baseUrl: 'http://example.com/v1', key: 'new-key' }),
    /HTTPS/,
  )
  await assert.rejects(services.listModels({ baseUrl: 'https://api.openai.com/v1' }), /API Key/)
})

test('new configuration can fetch before saving and malformed or failed responses are actionable', async () => {
  const services = new Services(store, async (_url, options) => {
    assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer new-key')
    return { ok: true, status: 200, json: async () => ({ data: [{ id: 'custom-model' }] }) }
  })
  const input = { baseUrl: 'https://example.com/v1', key: 'new-key' }
  assert.deepEqual(await services.listModels(input), ['custom-model'])
  for (const body of [{}, { data: [] }]) {
    services.fetcher = async () => ({ ok: true, status: 200, json: async () => body })
    await assert.rejects(services.listModels(input), /模型/)
  }
  services.fetcher = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: { code: 'invalid_api_key' } }),
  })
  await assert.rejects(services.listModels(input), /HTTP 401/)
})
