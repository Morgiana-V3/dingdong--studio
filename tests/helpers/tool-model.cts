import type { ToolRequest, ToolResponse, Condition, TiebaEntry } from '../../src/types.cjs'
export interface ModelRules {
  maximumItems: number
  forumName?: string
  globalFilter?: string
  forumFilter?: string
}
export interface ModelOptions {
  conditions?: Condition[]
  readFirst?: boolean
  score?: number
  choose?(entries: TiebaEntry[], rules: ModelRules): TiebaEntry[]
}
function call(name: string, args: unknown, index: number): ToolResponse {
  return {
    output: [
      { type: 'function_call', call_id: 'call_' + index, name, arguments: JSON.stringify(args) },
    ],
  }
}
function modelResponse(request: ToolRequest, options: ModelOptions = {}): ToolResponse {
  if (request.tools[0]?.name === 'plan_forum_searches')
    return call('plan_forum_searches', { queries: ['动画'] }, 0)
  const calls = request.input.filter((item) => item.type === 'function_call')
  const last = calls.at(-1)
  const rules = JSON.parse(request.input[0].content as string) as ModelRules
  const index = calls.length + 1
  const resultFor = (name: string): { candidates?: TiebaEntry[] } => {
    const toolCall = calls.findLast((item) => item.name === name)
    return toolCall
      ? JSON.parse(
          request.input.findLast(
            (item) => item.type === 'function_call_output' && item.call_id === toolCall.call_id,
          )!.output!,
        )
      : {}
  }
  if (!last) {
    return call('list_candidates', {}, index)
  }
  if (last.name === 'list_candidates') {
    return call('filter_candidates', { conditions: options.conditions || [], match: 'all' }, index)
  }
  const candidates = resultFor('filter_candidates').candidates || []
  const chosen = (
    options.choose ? options.choose(candidates, rules) : candidates.slice(0, 1)
  ).slice(0, rules.maximumItems)
  if (last.name === 'filter_candidates' && options.readFirst && chosen.length) {
    return call('read_posts', { ids: chosen.slice(0, 3).map((entry) => entry.id) }, index)
  }
  return call(
    'submit_selection',
    {
      selected: chosen.map((entry) => ({
        id: entry.id,
        score: options.score ?? 91,
        reason: '匹配有效兴趣规则',
      })),
      unavailableReason: '',
    },
    index,
  )
}
export { call, modelResponse }
