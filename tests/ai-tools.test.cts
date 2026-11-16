import { serviceStore, testDouble } from './helpers/fixtures.cjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Services } from '../src/services.cjs'
import { tools } from '../examples/tieba/agent.cjs'
const store = serviceStore({
  providers: [
    {
      id: 'provider',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-test',
      secret: 'encrypted',
      maxOutputTokens: 1500,
    },
  ],
  key: 'test-key',
})
const request = {
  instructions: '执行用户要求',
  input: [{ role: 'user', content: '回帖超过20' }],
  tools,
}
const output = [
  { type: 'reasoning', id: 'rs', summary: [], encrypted_content: 'opaque' },
  { type: 'function_call', call_id: 'call', name: 'list_candidates', arguments: '{}' },
]
test('respond sends bounded function tools through the shared provider and preserves protocol output', async () => {
  const services = new Services(store, async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses')
    assert.equal(options.redirect, 'error')
    const body = JSON.parse(String(options.body))
    assert.equal(body.store, false)
    assert.equal(body.parallel_tool_calls, false)
    assert.equal(body.tool_choice, 'required')
    assert.equal(body.max_output_tokens, 1500)
    assert.deepEqual(body.include, ['reasoning.encrypted_content'])
    assert.deepEqual(body.tools, tools)
    return { ok: true, status: 200, json: async () => ({ status: 'completed', output }) }
  })
  assert.deepEqual(await services.respond('provider', request), { output })
  await assert.rejects(services.respond('missing', request), /AI 配置/)
  await assert.rejects(
    services.respond('provider', testDouble({ ...request, tools: [{ type: 'web_search' }] })),
    /格式/,
  )
})
test('incomplete and text-only tool responses fail without accepting partial selections', async () => {
  for (const body of [
    { status: 'incomplete', output },
    {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'done' }] }],
    },
  ]) {
    const services = new Services(store, async () => ({
      ok: true,
      status: 200,
      json: async () => body,
    }))
    await assert.rejects(services.respond('provider', request), /工具/)
  }
})
