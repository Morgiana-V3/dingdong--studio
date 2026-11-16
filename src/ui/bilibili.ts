import type { PanelOptions } from './dom.js'
import type { BiliAccount, BiliUser } from '../types.cjs'
import { query as getElement, errorMessage } from './dom.js'
export function openBilibili({ dialog, content, api, escape, onCreate }: PanelOptions) {
  content.innerHTML = `<h2>B 站登录与订阅</h2><div id="bili-panel"><div class="bili-account"><strong id="bili-account">正在检查登录状态…</strong><span class="help">在独立窗口中使用 B 站 App 扫码。登录状态保留在本机。</span></div><div class="bili-toolbar"><button type="button" id="bili-login">登录 B 站</button><button type="button" id="bili-refresh">刷新登录状态</button><button type="button" id="bili-logout" class="danger">退出本机登录</button></div><p id="bili-status" class="help" role="status"></p><label>筛选已加载的关注<input id="bili-search" type="search" placeholder="UP 主名称或 UID"></label><div id="bili-count" class="help"></div><div id="bili-followings" class="bili-followings"></div><button type="button" id="bili-more" hidden>加载更多关注</button><div class="bili-toolbar"><button type="button" id="bili-preview">预览所选 UP 主的视频</button></div><div id="bili-videos"></div><p class="help">预览只检查最近两页关注视频动态，不发送通知。首次执行任务会建立基线，之后才推送新视频；当前版本读取标题与简介。</p></div><div class="form-footer"><button type="button" id="bili-close">关闭</button><button type="button" class="primary" id="bili-create">配置推送任务</button></div>`
  const panel = getElement<HTMLElement>(content, '#bili-panel')
  const status = getElement<HTMLElement>(panel, '#bili-status')
  const list = getElement<HTMLElement>(panel, '#bili-followings')
  const search = getElement<HTMLInputElement>(panel, '#bili-search')
  const more = getElement<HTMLButtonElement>(panel, '#bili-more')
  const selected = new Set<string>()
  let account: BiliAccount | null = null
  let users: BiliUser[] = []
  let currentPage = 0
  let total = 0
  let busy = false
  dialog.showModal()
  content.scrollTop = 0

  function draw() {
    const query = search.value.trim().toLowerCase()
    const visible = users.filter((user) =>
      (user.name + ' ' + user.mid).toLowerCase().includes(query),
    )
    list.innerHTML =
      visible
        .map(
          (user) =>
            `<label class="check bili-user"><input type="checkbox" value="${escape(user.mid)}" ${selected.has(user.mid) ? 'checked' : ''}><span><strong>${escape(user.name)}</strong><small>UID ${escape(user.mid)}</small></span></label>`,
        )
        .join('') || '<p class="help">暂无匹配的关注。</p>'
    getElement<HTMLElement>(panel, '#bili-count').textContent =
      `已加载 ${users.length} / ${total} 位 · 已选择 ${selected.size} 位（最多 50 位）`
  }

  async function perform(button: HTMLButtonElement, operation: () => Promise<void>) {
    if (busy) {
      return
    }
    busy = true
    button.disabled = true
    status.textContent = '正在读取…'
    try {
      await operation()
    } catch (error) {
      if (panel.isConnected) {
        status.textContent = errorMessage(error)
      }
    } finally {
      busy = false
      button.disabled = false
    }
  }

  async function loadPage() {
    const response = await api.invoke('bilibiliFollowings', {
      accountMid: account!.mid,
      page: currentPage + 1,
    })
    if (!panel.isConnected) {
      return
    }
    const known = new Map(users.map((user) => [user.mid, user]))
    for (const user of response.users) {
      known.set(user.mid, user)
    }
    users = [...known.values()]
    currentPage = response.page
    total = response.total
    more.hidden = !response.hasMore
    draw()
    status.textContent = response.hasMore ? '可继续加载更多关注。' : '关注列表已加载完成。'
  }

  async function refreshAccount() {
    const response = await api.invoke('bilibiliAccount')
    if (!panel.isConnected) {
      return
    }
    if (account?.mid !== response.mid) {
      users = []
      selected.clear()
      currentPage = 0
      total = 0
      more.hidden = true
      getElement<HTMLElement>(panel, '#bili-videos').innerHTML = ''
    }
    account = response
    getElement<HTMLElement>(panel, '#bili-account').textContent = account.loggedIn
      ? `${account.name} · UID ${account.mid}`
      : '尚未登录 B 站'
    draw()
    if (account.loggedIn && currentPage === 0) {
      await loadPage()
    } else {
      status.textContent = account.loggedIn
        ? '登录有效，可选择订阅的 UP 主。'
        : '点击「登录 B 站」，扫码完成后刷新登录状态。'
    }
  }

  getElement<HTMLButtonElement>(panel, '#bili-login').onclick = (event) =>
    perform(event.currentTarget as HTMLButtonElement, async () => {
      await api.invoke('bilibiliLogin')
      status.textContent = '登录窗口已打开。扫码完成后，点击「刷新登录状态」。'
    })
  getElement<HTMLButtonElement>(panel, '#bili-refresh').onclick = (event) =>
    perform(event.currentTarget as HTMLButtonElement, refreshAccount)
  getElement<HTMLButtonElement>(panel, '#bili-logout').onclick = (event) =>
    perform(event.currentTarget as HTMLButtonElement, async () => {
      await api.invoke('bilibiliLogout')
      await refreshAccount()
    })
  more.onclick = () => perform(more, loadPage)
  search.oninput = draw
  list.onchange = (event) => {
    const input = event.target as HTMLInputElement
    if (input.checked && selected.size >= 50) {
      input.checked = false
      status.textContent = '每个任务最多选择 50 位 UP 主。'
      return
    }
    if (input.checked) {
      selected.add(input.value)
    } else {
      selected.delete(input.value)
    }
    draw()
  }
  getElement<HTMLButtonElement>(panel, '#bili-preview').onclick = (event) =>
    perform(event.currentTarget as HTMLButtonElement, async () => {
      if (!account?.loggedIn || !selected.size) {
        throw new Error('请先登录并勾选需要订阅的 UP 主')
      }
      const response = await api.invoke('bilibiliPreview', { accountMid: account!.mid })
      if (!panel.isConnected) {
        return
      }
      const videos = response.videos.filter((video) => selected.has(video.authorId)).slice(0, 20)
      getElement<HTMLElement>(panel, '#bili-videos').innerHTML = videos
        .map(
          (video) =>
            `<div class="bili-video"><strong>${escape(video.title)}</strong><p class="meta">${escape(video.author)} · ${escape(new Date(video.publishedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }))}</p><p>${escape(video.description)}</p><span class="help">${escape(video.url)}</span></div>`,
        )
        .join('')
      status.textContent = videos.length
        ? `预览 ${videos.length} 个视频，尚未发送。`
        : '最近两页关注动态中没有所选 UP 主的视频，仍可创建任务等待更新。'
    })
  getElement<HTMLButtonElement>(content, '#bili-close').onclick = () => dialog.close()
  getElement<HTMLButtonElement>(content, '#bili-create').onclick = () => {
    if (!account?.loggedIn || !selected.size) {
      status.textContent = '请先登录并至少选择一位 UP 主。'
      return
    }
    if (busy) {
      return
    }
    dialog.close()
    onCreate({
      name: 'B 站新视频订阅',
      pluginId: 'bilibili-videos',
      schedule: { type: 'interval', minutes: 30 },
      enabled: true,
      config: {
        accountMid: account!.mid,
        upIds: [...selected].join(','),
        keywords: '',
        useAI: false,
        maxItems: 8,
      },
    })
  }
  void perform(getElement<HTMLButtonElement>(panel, '#bili-refresh'), refreshAccount)
}
