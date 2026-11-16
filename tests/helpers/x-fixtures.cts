import type { XPost } from '../../src/x-types.cjs'
import type { ToolRequest, ToolResponse } from '../../src/types.cjs'
import { call } from './tool-model.cjs'
export function xPost(overrides: Partial<XPost> = {}): XPost {
  return {
    id: '12345',
    text: '开源模型发布，附上实际使用方法。',
    authorId: '100',
    username: 'fixture',
    url: 'https://x.com/fixture/status/12345',
    createdAt: Date.now() - 3600000,
    likeCount: 25,
    replyCount: 21,
    repostCount: 3,
    images: [],
    truncated: false,
    ...overrides,
  }
}
export function xModel(request: ToolRequest): ToolResponse {
  if (request.tools[0]?.name === 'plan_searches')
    return call(
      'plan_searches',
      { queries: [{ topic: '开源模型', query: 'open source model' }] },
      0,
    )
  const calls = request.input.filter((item) => item.type === 'function_call')
  const last = calls.at(-1)
  const index = calls.length + 1
  if (!last) {
    return call('search_posts', { query: 'open source model', sort: 'Latest' }, index)
  }
  if (last.name === 'search_posts') {
    return call(
      'filter_posts',
      { conditions: [{ field: 'replyCount', operator: 'gt', value: 20 }], match: 'all' },
      index,
    )
  }
  const filterCall = calls.findLast((item) => item.name === 'filter_posts')!
  const result = JSON.parse(
    request.input.find(
      (item) => item.type === 'function_call_output' && item.call_id === filterCall.call_id,
    )!.output!,
  ) as { candidates: XPost[] }
  if (last.name === 'filter_posts' && result.candidates.length) {
    return call('read_x_posts', { ids: [result.candidates[0].id] }, index)
  }
  return call(
    'submit_selection',
    {
      selected: result.candidates.slice(0, 1).map((post) => ({ id: post.id, score: 90 })),
      unavailableReason: '',
    },
    index,
  )
}
