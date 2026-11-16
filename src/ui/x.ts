import type { PanelOptions } from './dom.js'
import type { XAccount, XPost } from '../x-types.cjs'
import { query as getElement, errorMessage } from './dom.js'
import { toolTraceHTML } from './tool-trace.js'

export function openX({ dialog, content, api, escape, providers = [], onCreate }: PanelOptions) {
  content.innerHTML = `<h2>X 兴趣发现</h2><div id="x-panel"><div class="bili-account"><strong id="x-account">正在检查登录状态…</strong><span class="help">已在 Chrome 登录 X？可「导入 Chrome 登录」一次，后续由后台脚本执行任务，无需 Chrome 保持运行。也可单独打开登录窗口。</span></div><div class="bili-toolbar"><button type="button" id="x-login">登录 X</button><button type="button" id="x-chrome">使用 Chrome 登录</button><button type="button" id="x-import">导入 Chrome 登录</button><button type="button" id="x-refresh">刷新登录状态</button><button type="button" id="x-logout" class="danger">退出本机登录</button></div><p class="help">导入前，在常用 Chrome 打开 chrome://inspect/#remote-debugging 并开启连接，再在 Chrome 弹窗中允许。仅导入 X 登录凭据并在本机加密保存，不保存密码；导入后可以关闭该调试开关。</p><label>兴趣说明<textarea id="x-interests" rows="5" maxlength="5000" placeholder="例如：寻找 AI 开源工具和模型发布，优先能实际使用的项目，排除广告和课程推广。只看最近 7 天、点赞超过 20 的帖子。"></textarea></label><label>用于发现与筛选的 AI<select id="x-provider"><option value="">请选择已配置的 AI</option>${providers.map((provider) => `<option value="${escape(provider.id)}">${escape(provider.name)} · ${escape(provider.model)}</option>`).join('')}</select></label><p class="help">先读取关注时间线，再按兴趣拆成最多 3 组关键词，各取最新和热门结果，合并后筛选。可在任务配置里关闭任一路来源；检索计划和实际数量可在工具执行过程查看。默认近 7 天，不保证全量覆盖。</p><div class="bili-toolbar"><button type="button" id="x-preview">预览 AI 精选</button></div><p class="help">预览使用所选 API 额度，不发送消息、不改变已推送记录。只展示原文节选与配图；AI 暂不识别图片、视频或他人评论。</p><details><summary>测试关键词搜索</summary><label>搜索词<input id="x-query" maxlength="300" placeholder="例如 OpenAI"></label><button type="button" id="x-search">检查连接与候选</button></details><p id="x-status" class="help" role="status"></p><div id="x-trace"></div><div id="x-posts"></div></div><div class="form-footer"><button type="button" id="x-close">关闭</button><button type="button" class="primary" id="x-create">配置推送任务</button></div>`
  const panel = getElement<HTMLElement>(content, '#x-panel')
  const status = getElement<HTMLElement>(panel, '#x-status')
  let account: XAccount = { hasSession: false }
  let busy = false
  dialog.showModal()
  content.scrollTop = 0
  const provider = () => getElement<HTMLSelectElement>(panel, '#x-provider').value
  const config = () => ({
    accountId: account.id || '',
    interests: getElement<HTMLTextAreaElement>(panel, '#x-interests').value.trim(),
    maxItems: 3,
    includeImages: true,
  })
  function draw(posts: XPost[]) {
    getElement<HTMLElement>(panel, '#x-posts').innerHTML = posts
      .map(
        (post) =>
          `<div class="bili-video"><p>${escape(Array.from(post.text).slice(0, 500).join('')).replace(/\n/g, '<br>')}</p><p class="meta">点赞 ${post.likeCount ?? '未知'} · 回复 ${post.replyCount ?? '未知'} · 转发 ${post.repostCount ?? '未知'}</p>${post.images[0] ? `<img class="tieba-cover" src="${escape(post.images[0])}" alt="帖子配图" loading="lazy" referrerpolicy="no-referrer"><span class="help" hidden>图片暂时无法加载，可打开原帖查看。</span>` : ''}<span class="help">${escape(post.url)}</span></div>`,
      )
      .join('')
    for (const image of panel.querySelectorAll<HTMLImageElement>('.tieba-cover')) {
      const failed = () => {
        image.hidden = true
        ;(image.nextElementSibling as HTMLElement).hidden = false
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
    const controls = [
      ...panel.querySelectorAll<HTMLInputElement>('input,textarea,select,button'),
      getElement<HTMLButtonElement>(content, '#x-create'),
    ]
    for (const control of controls) {
      control.disabled = true
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
      for (const control of controls) {
        control.disabled = false
      }
    }
  }
  async function refresh() {
    const result = await api.invoke('xAccount')
    if (!panel.isConnected) {
      return
    }
    if (account.id !== result.id) {
      draw([])
      getElement<HTMLElement>(panel, '#x-trace').innerHTML = ''
    }
    account = result
    getElement<HTMLElement>(panel, '#x-account').textContent = account.hasSession
      ? `已保存 X 登录 · 账号 ${account.id}`
      : '尚未登录 X'
    status.textContent = account.hasSession
      ? '已找到本机登录状态，可通过搜索或预览验证读取。'
      : '点击「登录 X」，完成后刷新登录状态。'
  }
  function requireAccount() {
    if (!account.hasSession || !account.id) {
      throw new Error('请先登录 X 并刷新登录状态')
    }
    return account.id
  }
  function validate() {
    requireAccount()
    if (!config().interests || !provider()) {
      throw new Error('请填写兴趣说明并选择 AI 配置')
    }
  }
  getElement<HTMLButtonElement>(panel, '#x-login').onclick = () =>
    perform(async () => {
      await api.invoke('xLogin')
      if (panel.isConnected) {
        status.textContent = 'X 官方登录窗口已打开，完成后请刷新登录状态。'
      }
    })
  getElement<HTMLButtonElement>(panel, '#x-chrome').onclick = () =>
    perform(async () => {
      await api.invoke('xLoginChrome')
      if (panel.isConnected) {
        status.textContent =
          'DingDong Studio 专用 Chrome 已打开。登录完成后刷新状态；登录后点击「刷新登录状态」保存凭据，后续搜索在后台执行。'
      }
    })
  getElement<HTMLButtonElement>(panel, '#x-import').onclick = () =>
    perform(async () => {
      status.textContent = '请在已登录 X 的 Chrome 中允许连接…'
      await api.invoke('xImportChromeSession')
      await refresh()
      if (panel.isConnected) {
        status.textContent = 'X 登录已加密保存。可关闭 Chrome 和调试开关，然后测试后台搜索。'
      }
    })
  getElement<HTMLButtonElement>(panel, '#x-refresh').onclick = () =>
    perform(async () => {
      await api.invoke('xRefreshSession')
      await refresh()
    })
  getElement<HTMLButtonElement>(panel, '#x-logout').onclick = () =>
    perform(async () => {
      await api.invoke('xLogout')
      await refresh()
    })
  getElement<HTMLButtonElement>(panel, '#x-search').onclick = () =>
    perform(async () => {
      const result = await api.invoke('xSearchPreview', {
        accountId: requireAccount(),
        query: getElement<HTMLInputElement>(panel, '#x-query').value.trim(),
        sort: 'Latest',
      })
      if (!panel.isConnected) {
        return
      }
      draw(result.posts)
      getElement<HTMLElement>(panel, '#x-trace').innerHTML = ''
      status.textContent = `读取 ${result.posts.length} 条候选，尚未筛选。${result.scope}`
    })
  getElement<HTMLButtonElement>(panel, '#x-preview').onclick = () =>
    perform(async () => {
      validate()
      const response = await api.invoke('xInterestPreview', {
        config: config(),
        providerId: provider(),
      })
      if (!panel.isConnected) {
        return
      }
      getElement<HTMLElement>(panel, '#x-trace').innerHTML = toolTraceHTML(response.trace, escape)
      if ('error' in response) {
        draw([])
        throw new Error(response.error)
      }
      draw(response.selected)
      status.textContent = `候选 ${response.candidateCount} 条，入选 ${response.selected.length} 条。${response.selected.length ? '以下为原文节选，尚未发送。' : '没有合适内容时不会推送。'}`
    })
  getElement<HTMLButtonElement>(content, '#x-close').onclick = () => dialog.close()
  getElement<HTMLButtonElement>(content, '#x-create').onclick = () =>
    perform(async () => {
      await refresh()
      validate()
      if (!panel.isConnected || !dialog.open) {
        return
      }
      dialog.close()
      onCreate({
        name: 'X 兴趣发现',
        pluginId: 'x-interests',
        providerId: provider(),
        schedule: { type: 'daily', time: '20:00' },
        enabled: true,
        config: config(),
      })
    })
  void perform(refresh)
}
