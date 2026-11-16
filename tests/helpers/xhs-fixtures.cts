import type { XHSNote } from '../../src/xhs-types.cjs'
import type { ToolRequest } from '../../src/types.cjs'
import { call } from './tool-model.cjs'
export const accountId = '1234567890abcdef12345678'
export const noteId = 'abcdef1234567890abcdef12'
export function xhsNote(overrides: Partial<XHSNote> = {}): XHSNote {
  return {
    id: noteId,
    token: 'fixture-token',
    title: '本地 AI 工具实践',
    body: '原文：在 Mac 上配置一个实用工具。',
    url: `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=fixture-token&xsec_source=pc_feed`,
    images: [],
    publishedAt: Date.now(),
    likes: 120,
    comments: 25,
    collects: 80,
    video: false,
    truncated: false,
    ...overrides,
  }
}
export function xhsModel(request: ToolRequest) {
  if (request.tools[0]?.name === 'plan_searches')
    return call('plan_searches', { queries: ['AI 工具', '漫画', '二次元'] }, 0)
  const calls = request.input.filter((item) => item.type === 'function_call')
  const index = calls.length + 1
  if (!calls.length) {
    const { candidates } = JSON.parse(request.input[0].content as string) as {
      candidates: Array<{ id: string }>
    }
    return call('read_notes', { ids: candidates.slice(0, 3).map((item) => item.id) }, index)
  }
  if (calls.at(-1)?.name === 'read_notes')
    return call(
      'filter_notes',
      { conditions: [{ field: 'comments', operator: 'gt', value: 20 }] },
      index,
    )
  const { notes } = JSON.parse(request.input.at(-1)?.output || '{}') as { notes: XHSNote[] }
  return call(
    'submit_selection',
    {
      selected: (notes || []).slice(0, 3).map((note) => ({ id: note.id, score: 90 })),
      unavailableReason: '',
    },
    index,
  )
}
