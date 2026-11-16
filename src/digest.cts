import type { InstalledPlugin, Task, Message, PluginResult } from './types.cjs'

export const DIGEST_ID = 'minipush-digest'
export const digestPlugin: InstalledPlugin = {
  id: DIGEST_ID,
  name: '统一推送',
  version: '1.0.0',
  apiVersion: 1,
  entry: '',
  location: '',
  description: '调用选中的内容源，合成一份 HTML，只推送一次。沿用各来源的配置、AI 与去重记录。',
  fields: [{ key: 'sourceTaskIds', label: '选入的内容源', type: 'tasks', required: true }],
}
export function sourceIds(task: Pick<Task, 'config'>): string[] {
  const value = task.config.sourceTaskIds
  return typeof value === 'string' ? value.split(',').filter(Boolean) : []
}
export function digestOwner(tasks: Task[], id: string): Task | undefined {
  return tasks.find(
    (task) => task.pluginId === DIGEST_ID && task.enabled && sourceIds(task).includes(id),
  )
}
export function digestSources(
  tasks: Task[],
  task: Pick<Task, 'id' | 'config' | 'enabled'>,
): Task[] {
  const ids = sourceIds(task)
  if (!ids.length || ids.length > 8 || new Set(ids).size !== ids.length) {
    throw new Error('请选择 1–8 个不重复的内容源')
  }
  return ids.map((id) => {
    const source = tasks.find((entry) => entry.id === id)
    if (!source || source.id === task.id || source.pluginId === DIGEST_ID) {
      throw new Error('内容源不存在或是汇总任务，请重新选择')
    }
    const owner = digestOwner(tasks, id)
    if (task.enabled && owner && owner.id !== task.id) {
      throw new Error(`「${source.name}」已由「${owner.name}」统一推送`)
    }
    return source
  })
}
export function validateOutput(output: PluginResult, allowSections = false): void {
  const encoded = JSON.stringify(output)
  if (!encoded || encoded.length > 750000) {
    throw new Error('插件结果无效或超过 750 KB')
  }
  if (output.message === null) {
    return
  }
  const message = output.message
  if (
    !message ||
    typeof message.title !== 'string' ||
    !message.title.trim() ||
    typeof message.body !== 'string' ||
    message.title.length > 100 ||
    message.body.length > 50000 ||
    (message.format !== undefined && !['html', 'markdown', 'text'].includes(message.format))
  ) {
    throw new Error('插件需返回 message.title 和 message.body，或 message: null')
  }
  if (
    message.sections !== undefined &&
    (!allowSections ||
      !Array.isArray(message.sections) ||
      !message.sections.length ||
      message.sections.length > 8)
  ) {
    throw new Error('不支持嵌套汇总或无效的汇总内容')
  }
}
export function combineMessages(
  name: string,
  sections: NonNullable<Message['sections']>,
): Message | null {
  if (!sections.length) {
    return null
  }
  return {
    title: name,
    body: '',
    sections,
    short: sections
      .map((section) => section.message.short || section.name)
      .join(' · ')
      .slice(0, 120),
  }
}
