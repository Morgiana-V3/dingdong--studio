import type { XContext, XConfig, XPost } from '../../src/x-types.cjs'

export async function collect(context: XContext, config: XConfig) {
  const pools: Array<{ name: string; posts: XPost[] }> = []
  if (config.useFollowing !== false) {
    const feed = await context.sources.x.following({ accountId: config.accountId })
    pools.push({ name: '关注时间线', posts: feed.posts })
    context.log?.({
      tool: 'following_feed',
      status: 'ok',
      detail: `读取 ${feed.posts.length} 条；${feed.scope}`,
    })
  }
  if (config.useSearch !== false) {
    const response = await context.ai.respond({
      instructions:
        '为 X 兴趣发现制定补充检索计划。关注时间线已由插件独立采集，搜索不是唯一来源。将用户兴趣拆成 1–3 个独立主题，每个主题给一条查询。同义词可用括号和 OR 组合，不同兴趣不要用 AND 强制交集；短语可加引号。中文内容要求才用 lang:zh；不要将用户所有兴趣限制为中文。按明确要求使用 since:、until:、from: 等 X 语法，默认近 7 天。排除条件不是正面关键词，语义排除留给筛选。不要编造作者账号或过度缩窄。插件会对每条查询分别获取最新和热门结果。仅调用 plan_searches。',
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
          description: '提交独立主题查询，1–3 组',
          strict: true,
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['queries'],
            properties: {
              queries: {
                type: 'array',
                minItems: 1,
                maxItems: 3,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['topic', 'query'],
                  properties: { topic: { type: 'string' }, query: { type: 'string' } },
                },
              },
            },
          },
        },
      ],
    })
    const calls = response.output.filter((item) => item.type === 'function_call')
    if (calls.length !== 1 || calls[0].name !== 'plan_searches') throw new Error('X 检索计划无效')
    const plan = JSON.parse(calls[0].arguments || '{}') as {
      queries: Array<{ topic: string; query: string }>
    }
    if (
      !Array.isArray(plan.queries) ||
      !plan.queries.length ||
      plan.queries.length > 3 ||
      plan.queries.some(
        (item) =>
          !item ||
          typeof item.topic !== 'string' ||
          !item.topic.trim() ||
          item.topic.length > 80 ||
          typeof item.query !== 'string' ||
          !item.query.trim() ||
          item.query.length > 300,
      ) ||
      new Set(plan.queries.map((item) => item.query.trim().toLowerCase())).size !==
        plan.queries.length
    )
      throw new Error('X 检索计划包含无效或重复查询')
    for (const item of plan.queries) {
      context.log?.({
        tool: 'retrieval_plan',
        status: 'ok',
        detail: `${item.topic}：${item.query}；分别检索最新与热门`,
      })
      for (const sort of ['Latest', 'Top'] as const) {
        const found = await context.sources.x.search({
          accountId: config.accountId,
          query: item.query,
          sort,
        })
        pools.push({ name: `${item.topic} / ${sort}`, posts: found.posts })
        context.log?.({
          tool: 'search_posts',
          status: 'ok',
          detail: `${item.query}（${sort}）：${found.posts.length} 条；${found.scope}`,
        })
      }
    }
  }
  const sent = new Set(context.state.accountId === config.accountId ? context.state.sent || [] : [])
  const found = new Map<string, XPost>()
  const origins = new Map<string, Set<string>>()
  // Round-robin admission prevents the first query from consuming the whole candidate budget.
  for (let index = 0; index < 40; index++) {
    for (const pool of pools) {
      const post = pool.posts[index]
      if (!post || sent.has(post.id)) continue
      if (!found.has(post.id) && found.size < 120) found.set(post.id, post)
      if (found.has(post.id))
        origins.set(post.id, (origins.get(post.id) || new Set()).add(pool.name))
    }
  }
  context.log?.({
    tool: 'merge_candidates',
    status: 'ok',
    detail: `${pools.length} 路采集 ${pools.reduce((sum, pool) => sum + pool.posts.length, 0)} 条，合并去重保留 ${found.size} 条（最多 120）；已启用来源：${config.useFollowing !== false ? '关注时间线' : ''}${config.useSearch !== false ? '、关键词补充' : ''}；不保证全量覆盖`,
  })
  return { posts: [...found.values()], origins }
}
