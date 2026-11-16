import { collect } from './retrieval.cjs'
import type { PushArticle } from '../../src/types.cjs'
import type {
  PluginConfig,
  TiebaConfig,
  TiebaEntry,
  TiebaContext,
  Forum,
  ForumState,
  TiebaState,
  SelectedEntry,
} from '../../src/types.cjs'
import { errorMessage } from './errors.cjs'
import { selectWithTools, matches } from './agent.cjs'

function plain(value: unknown) {
  return String(value).replace(/[\\`*_{}\[\]<>#]/g, '\\$&')
}
function configValues(config: PluginConfig): TiebaConfig {
  const legacy = config.forums === undefined
  const globalFilter = String(
    legacy
      ? [config.interests, config.exclude && '排除：' + config.exclude].filter(Boolean).join('\n')
      : config.globalFilter || '',
  ).trim()
  const raw = legacy ? [{ name: config.target, filter: '' }] : config.forums
  if (!Array.isArray(raw) || !raw.length || raw.length > 5 || globalFilter.length > 5000) {
    throw new Error('请配置 1–5 个贴吧，总过滤说明最多 5000 字')
  }
  const names = new Set()
  const forums = raw.map((forum) => {
    const name = typeof forum?.name === 'string' ? forum.name.trim() : ''
    const filter = typeof forum?.filter === 'string' ? forum.filter.trim() : ''
    const key = name.toLowerCase()
    if (!name || name.length > 60 || /[\r\n<>/:]/.test(name) || names.has(key)) {
      throw new Error('请填写不重复的完整吧名（不含网址）')
    }
    if (filter.length > 3000 || (!globalFilter && !filter)) {
      throw new Error('每个贴吧需有可用的兴趣过滤说明；单独说明最多 3000 字')
    }
    names.add(key)
    return { name, filter }
  })
  const maxItems = Number(config.maxItems ?? 3)
  const minScore = Number(config.minScore ?? 75)
  if (
    !Number.isInteger(maxItems) ||
    maxItems < 1 ||
    maxItems > 5 ||
    !Number.isInteger(minScore) ||
    minScore < 1 ||
    minScore > 100
  ) {
    throw new Error('每次精选条数为 1–5，相关度门槛为 1–100')
  }
  return { globalFilter, forums, maxItems, minScore, includeImages: config.includeImages !== false }
}
function links(entry: Pick<TiebaEntry, 'id' | 'title'>) {
  if (!/^\d+$/.test(entry.id)) {
    throw new Error('帖子编号无效')
  }
  return `[${plain(entry.title).replace(/\s+/g, ' ')}](com.baidu.tieba://unidispatch/pb?tid=${entry.id})`
}
function cover(entry: TiebaEntry, enabled: boolean) {
  const url = entry.images?.[0]
  if (
    !enabled ||
    typeof url !== 'string' ||
    !/^https:\/\/(tiebapic|imgsrc|imgsa)\.baidu\.com\//.test(url)
  ) {
    return ''
  }
  const escaped = url.replace(/[()'"<>\\\s]/g, (character) =>
    encodeURIComponent(character).replace(
      /[()']/g,
      (part) => '%' + part.charCodeAt(0).toString(16),
    ),
  )
  return `![帖子首图](${escaped})\n\n`
}
async function selectForum(
  context: TiebaContext,
  config: TiebaConfig,
  forum: Forum,
  previous: ForumState = {},
) {
  const response = await collect(context, config, forum, previous.sent || [])
  if (!Array.isArray(response.entries) || response.mode !== 'interests') {
    throw new Error(`${forum.name}吧未返回有效候选集`)
  }
  const sent = Array.isArray(previous.sent) ? previous.sent : []
  const candidates = response.entries
    .filter((entry) => !sent.includes(entry.id))
    .slice(0, 86)
    .map((entry) => ({ ...entry }))
  context.log?.({
    forum: forum.name,
    tool: 'collect_candidates',
    status: 'ok',
    detail: `采集 ${response.entries.length} 条候选，其中 ${candidates.length} 条尚未推送`,
  })
  const result = candidates.length
    ? await selectWithTools(context, config, forum, candidates)
    : { selected: [], read: new Map(), constraints: [] }
  return {
    name: forum.name,
    candidateCount: response.entries.length,
    evaluatedCount: candidates.length,
    read: result.read,
    origins: response.origins,
    state: {
      sent,
      pending: result.selected.map((entry) => ({
        ...entry,
        forum: forum.name,
        constraints: result.constraints,
        selectedAt: Date.parse(context.now),
      })),
    },
  }
}
async function select(context: TiebaContext, previous: TiebaState = {}) {
  const config = configValues(context.config)
  const oldForums = Array.isArray(previous.forums)
    ? previous.forums
    : previous.target
      ? [{ name: previous.target, state: previous }]
      : []
  const results: Awaited<ReturnType<typeof selectForum>>[] = []
  // At most two forums run tool loops concurrently; each loop is independently bounded.
  for (let start = 0; start < config.forums.length; start += 2) {
    const batch = await Promise.all(
      config.forums.slice(start, start + 2).map(async (forum) => {
        const old = oldForums.find((item) => item.name.toLowerCase() === forum.name.toLowerCase())
        try {
          return await selectForum(context, config, forum, old?.state)
        } catch (error) {
          throw new Error(`${forum.name}吧：${errorMessage(error)}`)
        }
      }),
    )
    results.push(...batch)
  }
  const unique = new Map<string, SelectedEntry>()
  for (const result of results) {
    for (const entry of result.state.pending) {
      if (!unique.has(entry.id) || unique.get(entry.id)!.score < entry.score) {
        unique.set(entry.id, entry)
      }
    }
  }
  const selected = [...unique.values()].sort((a, b) => b.score - a.score).slice(0, config.maxItems)
  for (let start = 0; start < selected.length; start += 2) {
    await Promise.all(
      selected.slice(start, start + 2).map(async (entry) => {
        const post =
          results.find((result) => result.name === entry.forum)?.read.get(entry.id) ||
          (await context.sources.tieba.post({ id: entry.id }))
        if (post.id !== entry.id || typeof post.body !== 'string') {
          throw new Error('首楼内容无效，不发送摘要替代原文')
        }
        const replyCount = Number.isSafeInteger(post.replyCount)
          ? post.replyCount
          : entry.replyCount
        if (
          !(entry.constraints || []).every((group) =>
            matches(
              { ...entry, replyCount },
              group.conditions,
              group.match,
              Date.parse(context.now),
            ),
          )
        ) {
          throw new Error('帖子最新数据已不满足硬性条件，本轮保留记录待重试')
        }
        Object.assign(entry, {
          replyCount,
          body: post.body,
          emoticons: post.emoticons || [],
          images: post.images || [],
          author: post.author || '',
          contentTruncated: Boolean(post.contentTruncated),
        })
      }),
    )
  }
  for (const entry of selected) {
    const origins = results.find((result) => result.name === entry.forum)?.origins.get(entry.id)
    context.log?.({
      tool: 'selection_sources',
      forum: entry.forum,
      status: 'ok',
      detail: `${entry.id}：${[...(origins || [])].join('、')}`,
    })
  }
  const chosen = new Set(selected.map((entry) => entry.id))
  for (const result of results) {
    const delivered = result.state.pending
      .filter((entry) => chosen.has(entry.id))
      .map((entry) => entry.id)
    result.state.sent = [...new Set([...result.state.sent, ...delivered])].slice(-2000)
    result.state.pending = result.state.pending.filter((entry) => !chosen.has(entry.id))
  }
  return {
    config,
    selected,
    forums: results.map(({ name, candidateCount, evaluatedCount }) => ({
      name,
      candidateCount,
      evaluatedCount,
    })),
    candidateCount: results.reduce((sum, result) => sum + result.candidateCount, 0),
    evaluatedCount: results.reduce((sum, result) => sum + result.evaluatedCount, 0),
    scopeDescription:
      '每吧保留最新帖与最近回复各 2 页，并按兴趣补充吧内查询；最多 86 条候选，不覆盖全吧历史',
    state: { version: 4, forums: results.map(({ name, state }) => ({ name, state })) },
  }
}
function excerpt(entry: Pick<TiebaEntry, 'body' | 'contentTruncated'>) {
  const text = entry.body.replace(/\r\n?/g, '\n').trim()
  const paragraphs = text.split(/\n+/).slice(0, 4).join('\n\n')
  const characters = [...paragraphs]
  const truncated =
    Boolean(entry.contentTruncated) || text.split(/\n+/).length > 4 || characters.length > 220
  let value = characters.slice(0, 220).join('')
  if (characters.length > 220) {
    const boundary = Math.max(
      value.lastIndexOf('。'),
      value.lastIndexOf('！'),
      value.lastIndexOf('？'),
    )
    if (boundary >= 100) {
      value = value.slice(0, boundary + 1)
    }
  }
  return { text: value + (truncated ? '…' : ''), truncated }
}
function originalText(value: string) {
  return plain(value)
    .replace(/([!|~])/g, '\\$1')
    .replace(/^(\s*)([-+]|\d+\.) /gm, '$1\\$2 ')
}
function format(result: Awaited<ReturnType<typeof select>>, task?: { name?: string }) {
  const { config, selected } = result
  if (!selected.length) {
    return null
  }
  const body = selected
    .map((entry) => {
      const content = excerpt(entry)
      return [
        `## ${links(entry)}`,
        `> ${plain(entry.forum)}吧`,
        originalText(content.text),
        content.truncated ? '> 首楼较长，已节选；点击标题查看全文。' : '',
        cover(entry, config.includeImages).trim(),
      ]
        .filter(Boolean)
        .join('\n\n')
    })
    .join('\n\n---\n\n')
  return {
    title: String(task?.name || '贴吧订阅')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100),
    body,
    articles: selected.map((entry): PushArticle => ({
      kind: 'tieba',
      publishedAt: entry.createdAt ?? undefined,
      title: entry.title,
      body: entry.body,
      emoticons: entry.emoticons,
      source: entry.forum + '吧',
      url: 'https://tieba.baidu.com/p/' + entry.id,
      images: config.includeImages
        ? (entry.images || [])
            .filter((image) => /^https:\/\/(tiebapic|imgsrc|imgsa)\.baidu\.com\//.test(image))
            .slice(0, 4)
        : [],
      truncated: entry.contentTruncated,
    })),
    short: selected
      .map((entry) => excerpt(entry).text || entry.title)
      .join('；')
      .replace(/\s+/g, ' ')
      .slice(0, 120),
  }
}
export async function run(context: TiebaContext) {
  const result = await select(context, context.state)
  return {
    message: format(result, context.task),
    state: result.state,
    detail: result.selected.length
      ? `兴趣筛选入选 ${result.selected.length} 条`
      : '本轮没有值得再次推送的兴趣匹配内容',
  }
}
export async function preview(context: TiebaContext) {
  const result = await select(context)
  return {
    selected: result.selected.map((entry) => ({ ...entry, previewText: excerpt(entry).text })),
    forums: result.forums,
    candidateCount: result.candidateCount,
    evaluatedCount: result.evaluatedCount,
    scopeDescription: result.scopeDescription,
    message: format(result, context.task),
  }
}
export { configValues }
export { links }

export { excerpt }
