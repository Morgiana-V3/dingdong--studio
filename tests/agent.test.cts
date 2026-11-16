import type { AI, Trace, Condition } from '../src/types.cjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { selectWithTools, matches } from '../examples/tieba/agent.cjs'
import { call, modelResponse } from './helpers/tool-model.cjs'
const config = { globalFilter: '动画，回帖数超过 20', minScore: 75, maxItems: 3 }
const forum = { name: '动画', filter: '' }
const entries = [
  {
    id: '1',
    url: 'https://tieba.baidu.com/p/1',
    title: '动画 20',
    body: '摘要',
    replyCount: 20,
    createdAt: 1000,
  },
  {
    id: '2',
    url: 'https://tieba.baidu.com/p/2',
    title: '动画 21',
    body: '摘要',
    replyCount: 21,
    createdAt: 1000,
  },
  {
    id: '3',
    url: 'https://tieba.baidu.com/p/3',
    title: '未知',
    body: '摘要',
    replyCount: null,
    createdAt: null,
  },
]
function context(respond: AI['respond']) {
  const trace: Trace[] = []
  return {
    trace,
    now: new Date(10000000).toISOString(),
    log: (event: Trace) => trace.push(event),
    ai: { respond },
    sources: {
      tieba: { post: async ({ id }: { id: string }) => ({ id, body: '首楼原文', replyCount: 21 }) },
    },
  }
}
test('tool comparisons enforce strict boundary, unknown values, AND/OR and time age', () => {
  const condition: Condition[] = [{ field: 'replyCount', operator: 'gt', value: 20 }]
  assert.equal(matches(entries[0], condition, 'all', 10000000), false)
  assert.equal(matches(entries[1], condition, 'all', 10000000), true)
  assert.equal(
    matches(entries[2], [{ field: 'replyCount', operator: 'ne', value: 20 }], 'all', 10000000),
    false,
  )
  assert.equal(
    matches(
      entries[0],
      [...condition, { field: 'ageHours', operator: 'lt', value: 3 }],
      'any',
      10000000,
    ),
    true,
  )
  assert.equal(
    matches(
      entries[0],
      [...condition, { field: 'ageHours', operator: 'lt', value: 3 }],
      'all',
      10000000,
    ),
    false,
  )
})
test('model can choose tools and read full first post before submitting', async () => {
  const ctx = context(async (request) =>
    modelResponse(request, {
      conditions: [{ field: 'replyCount', operator: 'gt', value: 20 }],
      readFirst: true,
    }),
  )
  const result = await selectWithTools(ctx, config, forum, structuredClone(entries))
  assert.deepEqual(
    result.selected.map((entry) => entry.id),
    ['2'],
  )
  assert.deepEqual(
    ctx.trace.map((entry) => entry.tool),
    ['list_candidates', 'filter_candidates', 'read_posts', 'submit_selection'],
  )
  assert.equal(result.read.get('2')!.body, '首楼原文')
})
test('attempt to select filtered or invented ID is rejected and can be corrected', async () => {
  let turn = 0
  const ctx = context(async (request) => {
    turn++
    if (turn === 1) return call('list_candidates', {}, turn)
    if (turn === 2)
      return call(
        'filter_candidates',
        { conditions: [{ field: 'replyCount', operator: 'gt', value: 20 }], match: 'all' },
        turn,
      )
    if (turn === 3)
      return call(
        'submit_selection',
        { selected: [{ id: '1', score: 99, reason: '错误' }], unavailableReason: '' },
        turn,
      )
    assert.match(request.input.at(-1)!.output!, /必须满足工具过滤/)
    return call(
      'submit_selection',
      { selected: [{ id: '2', score: 90, reason: '回帖数满足' }], unavailableReason: '' },
      turn,
    )
  })
  const result = await selectWithTools(ctx, config, forum, structuredClone(entries))
  assert.deepEqual(
    result.selected.map((entry) => entry.id),
    ['2'],
  )
  assert.equal(ctx.trace[2].status, 'error')
})
test('unavailable required capability fails, not a successful empty result', async () => {
  let turn = 0
  const ctx = context(async () => {
    turn++
    if (turn === 1) return call('list_candidates', {}, turn)
    if (turn === 2) return call('filter_candidates', { conditions: [], match: 'all' }, turn)
    return call('submit_selection', { selected: [], unavailableReason: '不能读取评论内容' }, turn)
  })
  await assert.rejects(
    selectWithTools(ctx, config, forum, structuredClone(entries)),
    /无法满足.*评论/,
  )
})
test('unknown tools and malformed JSON are bounded with no arbitrary source access', async () => {
  let count = 0
  const ctx = context(async () => call('run_shell', { command: 'never' }, ++count))
  ctx.sources.tieba.post = async () => assert.fail('must not reach source')
  await assert.rejects(selectWithTools(ctx, config, forum, structuredClone(entries)), /6 轮/)
  assert.equal(count, 6)
  const malformed = context(async () => ({
    output: [
      { type: 'function_call', call_id: String(++count), name: 'list_candidates', arguments: '{' },
    ],
  }))
  await assert.rejects(selectWithTools(malformed, config, forum, structuredClone(entries)), /6 轮/)
})
test('changed detail count cannot revive a post rejected by active hard conditions', async () => {
  const ctx = context(async (request) =>
    modelResponse(request, {
      conditions: [{ field: 'replyCount', operator: 'gt', value: 20 }],
      readFirst: true,
    }),
  )
  ctx.sources.tieba.post = async ({ id }) => ({ id, body: '原文', replyCount: 19 })
  await assert.rejects(selectWithTools(ctx, config, forum, structuredClone(entries)), /6 轮/)
  assert(ctx.trace.some((entry) => entry.status === 'error'))
})
test('reasoning and tool outputs are replayed in order', async () => {
  let turn = 0
  const ctx = context(async (request) => {
    turn++
    if (turn === 1) {
      const result = call('list_candidates', {}, turn)
      result.output.unshift({
        type: 'reasoning',
        id: 'rs_1',
        summary: [],
        encrypted_content: 'opaque',
      })
      return result
    }
    assert.equal(request.input[1].type, 'reasoning')
    assert.equal(request.input[2].call_id, 'call_1')
    assert.equal(request.input[3].type, 'function_call_output')
    if (turn === 2) return call('filter_candidates', { conditions: [], match: 'all' }, turn)
    return call('submit_selection', { selected: [], unavailableReason: '' }, turn)
  })
  assert.deepEqual(
    (await selectWithTools(ctx, config, forum, structuredClone(entries))).selected,
    [],
  )
})
