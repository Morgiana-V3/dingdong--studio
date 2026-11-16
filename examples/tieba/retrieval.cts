import type { TiebaContext, TiebaConfig, Forum, TiebaEntry } from '../../src/types.cjs'

export async function collect(
  context: TiebaContext,
  config: TiebaConfig,
  forum: Forum,
  sent: string[] = [],
) {
  const feed = await context.sources.tieba.feed({ target: forum.name, mode: 'interests', pages: 2 })
  const found = new Map(feed.entries.map((entry) => [entry.id, entry]))
  const origins = new Map(
    feed.entries.map((entry) => [entry.id, new Set(['最新帖 / 最近回复列表'])]),
  )
  context.log?.({
    tool: 'forum_feed',
    forum: forum.name,
    status: 'ok',
    detail: `${feed.scopeDescription || '最新帖与最近回复列表'}；取得 ${found.size} 条`,
  })
  if (context.config.useSearch === false) return { ...feed, entries: [...found.values()], origins }
  const response = await context.ai.respond({
    instructions:
      '制定贴吧插件的补充检索词。最新发帖与最近回复列表已独立采集，搜索不是唯一来源。依据吧名和有效兴趣规则给出 1–3 个互补查询短语，每条围绕一个主题；不同同义词可以分开查询，不把所有兴趣拼成一长串。贴吧接口不保证支持 OR/AND，禁止搜索运算符。单独规则高于总规则，仅冲突部分覆盖；不把排除词当作正面搜索词，不用“有趣”“相关内容”作为查询。窄主题吧可用“最新话”“生肉”等具体主题词，避免重复吧名。只调用 plan_forum_searches。',
    input: [
      {
        role: 'user',
        content: JSON.stringify({
          forum: forum.name,
          globalFilter: config.globalFilter,
          forumFilter: forum.filter,
          now: context.now,
        }),
      },
    ],
    tools: [
      {
        type: 'function',
        name: 'plan_forum_searches',
        description: '提交 1–3 个吧内查询短语',
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
  if (calls.length !== 1 || calls[0].name !== 'plan_forum_searches')
    throw new Error('贴吧检索计划无效')
  const plan = JSON.parse(calls[0].arguments || '{}') as { queries: string[] }
  if (
    !Array.isArray(plan.queries) ||
    !plan.queries.length ||
    plan.queries.length > 3 ||
    plan.queries.some(
      (query) =>
        typeof query !== 'string' ||
        !query.trim() ||
        query.length > 80 ||
        /[\r\n]|\b(?:OR|AND)\b/.test(query),
    ) ||
    new Set(plan.queries.map((query) => query.trim())).size !== plan.queries.length
  )
    throw new Error('贴吧检索词无效或重复')
  context.log?.({
    tool: 'retrieval_plan',
    forum: forum.name,
    status: 'ok',
    detail: '保留列表来源，补充查询：' + plan.queries.join('；'),
  })
  const pools: TiebaEntry[][] = []
  for (const query of plan.queries) {
    const result = await context.sources.tieba.search({ target: forum.name, query })
    pools.push(result.entries)
    for (const entry of result.entries)
      origins.set(entry.id, (origins.get(entry.id) || new Set()).add('吧内搜索：' + query))
    context.log?.({
      tool: 'forum_search',
      forum: forum.name,
      status: 'ok',
      detail: `「${query}」：${result.entries.length} 条；${result.scopeDescription || '首批结果'}`,
    })
  }
  const additional = new Map<string, TiebaEntry>()
  for (let index = 0; index < 20 && additional.size < 6; index++) {
    for (const pool of pools) {
      const entry = pool[index]
      if (entry && !found.has(entry.id) && !sent.includes(entry.id) && additional.size < 6)
        additional.set(entry.id, entry)
    }
  }
  // Search has no reply counts. Hydrate a bounded, balanced sample before hard filters.
  for (const entry of additional.values()) {
    const post = await context.sources.tieba.post({ id: entry.id })
    if (post.id !== entry.id) throw new Error('贴吧搜索补读返回错误帖子')
    found.set(entry.id, { ...entry, ...post })
  }
  context.log?.({
    tool: 'merge_candidates',
    forum: forum.name,
    status: 'ok',
    detail: `列表 ${feed.entries.length} 条，搜索 ${pools.reduce((sum, pool) => sum + pool.length, 0)} 条；去重后补读 ${additional.size} 篇搜索新候选，共 ${found.size} 条。补读上限 6 篇，不代表搜索全量`,
  })
  return {
    ...feed,
    entries: [...found.values()],
    origins,
    scopeDescription: '列表每种排序 2 页 + 最多 3 组吧内查询；最多补读 6 篇搜索新候选',
  }
}
