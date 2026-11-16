import type { PanelOptions } from './dom.js'
import type { TiebaEntry } from '../types.cjs'
import { query as getElement, errorMessage } from './dom.js'
import { toolTraceHTML } from './tool-trace.js'
import { forumListHTML, bindForumLists, readForumList } from './forum-list.js'
export function openTieba({
  dialog,
  content,
  api,
  escape,
  providers = [],
  onCreate,
}: PanelOptions) {
  content.innerHTML = `<h2>贴吧兴趣精选</h2><div id="tieba-panel"><p class="help">告诉 AI 哪些内容值得你花时间阅读。符合兴趣才推送，不按新帖数量凑通知。</p><label>总过滤说明<textarea id="tieba-global" rows="4" maxlength="5000" placeholder="例如：关注动画讨论，回帖数超过 20；标题不清楚时阅读首楼"> </textarea></label>${forumListHTML([{ name: '', filter: '' }], escape)}<label>用于筛选的 AI<select id="tieba-provider"><option value="">请选择已配置的 AI</option>${providers.map((provider) => `<option value="${escape(provider.id)}">${escape(provider.name)} · ${escape(provider.model)}</option>`).join('')}</select></label><p class="help">保留最新帖和最近回复列表，再按各吧兴趣补充关键词搜索，合并后筛选。检索计划与采集数量可在工具执行过程查看；可在任务配置里关闭补充搜索。暂不读取评论或识别配图。</p><div class="bili-toolbar"><button type="button" id="tieba-preview">查看候选</button><button type="button" id="tieba-filter">预览 AI 精选</button></div><p class="help">AI 预览使用所选 API 额度，不发送消息，也不改变任务的筛选记录。默认门槛 75 分、所有贴吧合计最多 3 条，可在任务配置里调整。</p><p id="tieba-status" class="help" role="status"></p><div id="tieba-trace"></div><div id="tieba-posts"></div></div><div class="form-footer"><button type="button" id="tieba-close">关闭</button><button type="button" class="primary" id="tieba-create">配置精选任务</button></div>`
  const panel = getElement<HTMLElement>(content, '#tieba-panel')
  const status = getElement<HTMLElement>(panel, '#tieba-status')
  bindForumLists(panel, escape)
  let busy = false
  dialog.showModal()
  content.scrollTop = 0
  getElement<HTMLTextAreaElement>(panel, '#tieba-global').focus()
  const config = () => ({
    globalFilter: getElement<HTMLTextAreaElement>(panel, '#tieba-global').value.trim(),
    forums: readForumList(panel),
    minScore: 75,
    maxItems: 3,
    includeImages: true,
  })
  const provider = () => getElement<HTMLSelectElement>(panel, '#tieba-provider').value
  function draw(entries: Array<TiebaEntry & { forum?: string; previewText?: string }>) {
    getElement<HTMLElement>(panel, '#tieba-posts').innerHTML = entries
      .map(
        (entry) =>
          `<div class="bili-video"><strong>${escape(entry.title)}</strong><p class="meta">${escape(entry.forum || '')}吧${Number.isFinite(entry.replyCount) ? ' · 回帖 ' + entry.replyCount : ''}</p><p>${escape(entry.previewText ?? entry.body ?? '').replace(/\n/g, '<br>')}</p>${entry.images?.[0] ? `<img class="tieba-cover" src="${escape(entry.images[0])}" alt="帖子首图" loading="lazy" referrerpolicy="no-referrer"><span class="help tieba-image-error" hidden>图片暂时无法加载，可打开原帖查看。</span>` : ''}<span class="help">${escape(entry.url)}</span></div>`,
      )
      .join('')
    for (const image of panel.querySelectorAll<HTMLImageElement>('.tieba-cover')) {
      const failed = () => {
        image.hidden = true
        const warning = image.nextElementSibling as HTMLElement
        warning.hidden = false
      }
      image.addEventListener('error', failed)
      if (image.complete && !image.naturalWidth) {
        failed()
      }
    }
  }
  async function perform(operation: () => Promise<void>) {
    if (busy) {
      return
    }
    busy = true
    const inputs = [
      ...panel.querySelectorAll<HTMLInputElement>('input,textarea,select,button:not(:disabled)'),
      getElement<HTMLButtonElement>(content, '#tieba-create'),
    ]
    for (const input of inputs) {
      input.disabled = true
    }
    status.textContent = '正在处理…'
    try {
      await operation()
    } catch (error) {
      if (panel.isConnected) {
        status.textContent = errorMessage(error)
      }
    } finally {
      busy = false
      for (const input of inputs) {
        input.disabled = false
      }
    }
  }
  function validate() {
    const values = config()
    if (
      !values.forums.length ||
      values.forums.some((forum) => !forum.name || (!values.globalFilter && !forum.filter)) ||
      !provider()
    ) {
      throw new Error('请填写各贴吧名称、可用的过滤说明，并选择 AI 配置')
    }
    if (
      new Set(values.forums.map((forum) => forum.name.toLowerCase())).size !== values.forums.length
    ) {
      throw new Error('贴吧名称不能重复')
    }
  }
  getElement<HTMLButtonElement>(panel, '#tieba-preview').onclick = () =>
    perform(async () => {
      const forums = config().forums
      if (forums.some((forum) => !forum.name)) {
        throw new Error('请先填写各贴吧名称')
      }
      const entries = []
      for (const forum of forums) {
        const response = await api.invoke('tiebaPreview', { target: forum.name })
        entries.push(
          ...response.entries.slice(0, 10).map((entry) => ({ ...entry, forum: forum.name })),
        )
      }
      if (!panel.isConnected) {
        return
      }
      draw(entries)
      status.textContent = `展示 ${forums.length} 个贴吧的 ${entries.length} 条候选（每吧最多展示 10 条），尚未筛选。`
    })
  getElement<HTMLButtonElement>(panel, '#tieba-filter').onclick = () =>
    perform(async () => {
      validate()
      const response = await api.invoke('tiebaInterestPreview', {
        config: config(),
        providerId: provider(),
      })
      if (!panel.isConnected) {
        return
      }
      getElement<HTMLElement>(panel, '#tieba-trace').innerHTML = toolTraceHTML(
        response.trace,
        escape,
      )
      if ('error' in response) {
        draw([])
        throw new Error(response.error)
      }
      draw(response.selected)
      status.textContent = `候选 ${response.candidateCount} 条，入选 ${response.selected.length} 条。${response.selected.length ? '以下展示楼主原文节选，尚未发送。' : '没有合适内容时不会推送。'}`
    })
  getElement<HTMLButtonElement>(content, '#tieba-close').onclick = () => dialog.close()
  getElement<HTMLButtonElement>(content, '#tieba-create').onclick = () =>
    perform(async () => {
      validate()
      const values = config()
      const providerId = provider()
      for (const forum of values.forums) {
        await api.invoke('tiebaPreview', { target: forum.name })
      }
      if (!panel.isConnected || !dialog.open) {
        return
      }
      dialog.close()
      onCreate({
        name: `${values.forums.length === 1 ? values.forums[0].name + '吧' : '多个贴吧'} · 兴趣精选`,
        pluginId: 'tieba-subscription',
        providerId,
        schedule: { type: 'daily', time: '20:00' },
        enabled: true,
        config: values,
      })
    })
}
