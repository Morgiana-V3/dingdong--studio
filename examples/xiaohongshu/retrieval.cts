import type { XHSContext, XHSNote } from '../../src/xhs-types.cjs'
export interface Config {
  accountId: string
  interests: string
  maxItems: number
  includeImages: boolean
  useFeed: boolean
  useSearch: boolean
}
export async function collect(context: XHSContext, config: Config) {
  const pools: Array<{ name: string; notes: XHSNote[] }> = []
  if (config.useFeed) {
    const feed = await context.sources.xiaohongshu.feed({ accountId: config.accountId })
    pools.push({ name: '推荐流', notes: feed.notes })
    context.log?.({
      tool: 'xhs_feed',
      status: 'ok',
      detail: `${feed.notes.length} 篇；${feed.scope}`,
    })
  }
  if (config.useSearch) {
    const response = await context.ai.respond({
      instructions:
        '为小红书制定 1–3 条独立主题搜索词。多类兴趣分别搜索，同义词择常见表达；每条是简短自然语言关键词，不使用 X 的 OR、AND、since: 等语法，不把所有兴趣强制组合成一个交集。推荐流由插件独立采集。搜索是综合排序首屏，不能保证最新或全量；时间和互动要求交给后续工具筛选。只调用 plan_searches。',
      input: [
        {
          role: 'user',
          content: JSON.stringify({ interests: config.interests, now: context.now }),
        },
      ],
      tools: [
        {
          type: 'function',
          name: 'plan_searches',
          description: '规划最多 3 个主题查询',
          strict: true,
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['queries'],
            properties: {
              queries: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } },
            },
          },
        },
      ],
    })
    const calls = response.output.filter((item) => item.type === 'function_call')
    if (calls.length !== 1 || calls[0].name !== 'plan_searches')
      throw new Error('小红书检索计划无效')
    const plan = JSON.parse(calls[0].arguments || '{}') as { queries: string[] }
    if (
      !Array.isArray(plan.queries) ||
      !plan.queries.length ||
      plan.queries.length > 3 ||
      plan.queries.some(
        (query) => typeof query !== 'string' || !query.trim() || query.length > 80,
      ) ||
      new Set(plan.queries.map((query) => query.trim().toLowerCase())).size !== plan.queries.length
    )
      throw new Error('小红书搜索词无效或重复')
    for (const query of plan.queries) {
      context.log?.({ tool: 'retrieval_plan', status: 'ok', detail: `小红书综合搜索：${query}` })
      const feed = await context.sources.xiaohongshu.search({ accountId: config.accountId, query })
      pools.push({ name: query, notes: feed.notes })
      context.log?.({
        tool: 'xhs_search',
        status: 'ok',
        detail: `${query}：${feed.notes.length} 篇；${feed.scope}`,
      })
    }
  }
  const sent = new Set(context.state.accountId === config.accountId ? context.state.sent || [] : [])
  const catalog = new Map<string, XHSNote>()
  const origins = new Map<string, Set<string>>()
  for (let index = 0; index < 30; index++) {
    for (const pool of pools) {
      const note = pool.notes[index]
      if (!note || sent.has(note.id)) continue
      if (catalog.size < 90 && !catalog.has(note.id)) catalog.set(note.id, note)
      if (catalog.has(note.id))
        origins.set(note.id, (origins.get(note.id) || new Set()).add(pool.name))
    }
  }
  context.log?.({
    tool: 'merge_candidates',
    status: 'ok',
    detail: `${pools.length} 路来源，去重并排除已发送后保留 ${catalog.size} 篇（最多 90）`,
  })
  return { catalog, origins }
}
