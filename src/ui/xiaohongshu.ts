import type { PanelOptions } from './dom.js'
import type { XHSAccount } from '../xhs-types.cjs'
import { query, errorMessage } from './dom.js'
import { toolTraceHTML } from './tool-trace.js'
export function openXHS({ dialog, content, api, escape, providers = [], onCreate }: PanelOptions) {
  content.innerHTML = `<h2>小红书兴趣发现</h2><div id="xhs-panel"><div class="bili-account"><strong id="xhs-account">正在检查登录状态…</strong><span class="help">使用小红书 App 扫码登录，登录状态仅保存在这台 Mac 的独立浏览器资料中。</span></div><div class="bili-toolbar"><button type="button" id="xhs-login">登录小红书</button><button type="button" id="xhs-refresh">刷新登录状态</button><button type="button" id="xhs-logout" class="danger">退出本机登录</button></div><label>兴趣与筛选要求<textarea id="xhs-interests" rows="5" maxlength="5000">AI 工具、漫画和二次元内容。少而精，优先实用工具、原创分享和有内容的讨论，排除广告、卖课和引流。</textarea></label><label>用于检索与筛选的 AI<select id="xhs-provider"><option value="">请选择 AI 配置</option>${providers.map((provider) => `<option value="${escape(provider.id)}">${escape(provider.name)} · ${escape(provider.model)}</option>`).join('')}</select></label><p class="help">推荐流与最多 3 组主题搜索互补，合并去重后最多阅读 6 篇笔记原文，推送最多 3 篇。搜索读取综合排序首屏，默认筛选近 30 天；不保证全量覆盖。后台直连国内站读取，遇到验证时需打开登录窗口处理。</p><div class="bili-toolbar"><button type="button" id="xhs-preview">预览兴趣筛选</button></div><p class="help">预览会使用 AI API 额度，不发送消息。仅分析文字，不识别图片、观看视频或读取评论正文。</p><p id="xhs-status" class="help" role="status"></p><div id="xhs-trace"></div><div id="xhs-notes"></div></div><div class="form-footer"><button type="button" id="xhs-close">关闭</button><button type="button" id="xhs-create" class="primary">配置推送任务</button></div>`
  const panel = query<HTMLElement>(content, '#xhs-panel')
  const status = query<HTMLElement>(panel, '#xhs-status')
  let account: XHSAccount = { loggedIn: false }
  let busy = false
  const provider = () => query<HTMLSelectElement>(panel, '#xhs-provider').value
  const config = () => ({
    accountId: account.id || '',
    interests: query<HTMLTextAreaElement>(panel, '#xhs-interests').value.trim(),
    maxItems: 3,
    includeImages: true,
    useFeed: true,
    useSearch: true,
  })
  dialog.showModal()
  content.scrollTop = 0
  async function perform(operation: () => Promise<void>) {
    if (busy) return
    busy = true
    const controls = [
      ...panel.querySelectorAll<HTMLInputElement>('input,textarea,select,button'),
      query<HTMLButtonElement>(content, '#xhs-create'),
    ]
    controls.forEach((control) => (control.disabled = true))
    status.textContent = '正在处理…'
    try {
      await operation()
    } catch (error) {
      if (panel.isConnected) status.textContent = errorMessage(error)
    } finally {
      busy = false
      controls.forEach((control) => (control.disabled = false))
    }
  }
  async function refresh() {
    const result = await api.invoke('xhsAccount')
    if (!panel.isConnected) return
    if (result.id !== account.id) {
      query(panel, '#xhs-notes').innerHTML = ''
      query(panel, '#xhs-trace').innerHTML = ''
    }
    account = result
    query(panel, '#xhs-account').textContent = account.loggedIn
      ? `已登录 · ${account.name || account.id}`
      : '尚未登录小红书'
    status.textContent = account.loggedIn
      ? '可预览筛选，再配置任务加入汇总。'
      : '打开官方登录窗口，用手机扫码确认后刷新状态。'
  }
  function validate() {
    if (!account.loggedIn || !account.id) throw new Error('请先登录小红书并刷新状态')
    if (!config().interests || !provider()) throw new Error('请填写兴趣并选择 AI')
  }
  query<HTMLButtonElement>(panel, '#xhs-login').onclick = () =>
    perform(async () => {
      await api.invoke('xhsLogin')
      status.textContent = '官方窗口已打开，扫码确认登录后请刷新状态。'
    })
  query<HTMLButtonElement>(panel, '#xhs-refresh').onclick = () => perform(refresh)
  query<HTMLButtonElement>(panel, '#xhs-logout').onclick = () =>
    perform(async () => {
      await api.invoke('xhsLogout')
      await refresh()
    })
  query<HTMLButtonElement>(panel, '#xhs-preview').onclick = () =>
    perform(async () => {
      validate()
      const result = await api.invoke('xhsInterestPreview', {
        providerId: provider(),
        config: config(),
      })
      if (!panel.isConnected) return
      query(panel, '#xhs-trace').innerHTML = toolTraceHTML(result.trace, escape)
      query(panel, '#xhs-notes').innerHTML = ''
      if ('error' in result) throw new Error(result.error)
      query(panel, '#xhs-notes').innerHTML = result.selected
        .map(
          (note) =>
            `<div class="bili-video"><strong>${escape(note.title)}</strong><p>${escape(note.body.slice(0, 600)).replace(/\n/g, '<br>')}</p><p class="meta">点赞 ${note.likes ?? '未知'} · 评论 ${note.comments ?? '未知'} · 收藏 ${note.collects ?? '未知'}</p>${note.images[0] ? `<img class="tieba-cover" src="${escape(note.images[0])}" alt="笔记配图" loading="lazy" referrerpolicy="no-referrer">` : ''}</div>`,
        )
        .join('')
      for (const image of panel.querySelectorAll<HTMLImageElement>('img'))
        image.onerror = () => {
          image.hidden = true
        }
      status.textContent = `候选 ${result.candidateCount} 篇，入选 ${result.selected.length} 篇；尚未发送。`
    })
  query<HTMLButtonElement>(content, '#xhs-close').onclick = () => dialog.close()
  query<HTMLButtonElement>(content, '#xhs-create').onclick = () =>
    perform(async () => {
      await refresh()
      validate()
      if (!panel.isConnected || !dialog.open) return
      dialog.close()
      onCreate({
        name: '小红书兴趣发现',
        pluginId: 'xiaohongshu-interests',
        providerId: provider(),
        schedule: { type: 'manual' },
        enabled: false,
        config: config(),
      })
    })
  void perform(refresh)
}
