import type { Trace } from '../types.cjs'
import type { Escape } from './dom.js'
const labels: Record<string, string> = {
  xhs_feed: '小红书推荐流',
  xhs_search: '小红书关键词搜索',
  read_notes: '读取笔记原文',
  filter_notes: '执行笔记条件',
  selection_sources: '入选内容来源',
  retrieval_plan: '检索计划',
  following_feed: '关注时间线',
  forum_feed: '贴吧列表',
  forum_search: '吧内补充搜索',
  merge_candidates: '合并候选',
  collect_candidates: '采集候选',
  list_candidates: '查看候选',
  filter_candidates: '执行数据过滤',
  read_posts: '读取首楼',
  submit_selection: '提交结果',
  model: '调用 AI',
  search_posts: '搜索 X',
  filter_posts: '执行数据过滤',
  read_x_posts: '读取 X 原帖',
}
export function toolTraceHTML(trace: Trace[] | undefined, escape: Escape) {
  if (!Array.isArray(trace) || !trace.length) {
    return ''
  }
  return `<details class="tool-trace"><summary>工具执行过程 · ${trace.length} 步</summary><ol>${trace.map((entry) => `<li class="${entry.status === 'error' ? 'trace-error' : ''}"><strong>${entry.forum ? escape(entry.forum) + ' · ' : ''}${escape(labels[entry.tool] || entry.tool)}</strong><p>${escape(entry.detail)}</p></li>`).join('')}</ol></details>`
}
