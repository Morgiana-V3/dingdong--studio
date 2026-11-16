import type { BrowserWindow as ElectronBrowserWindow, Session } from 'electron'
import type { Video, BiliFeedInput, BiliFeed, BiliAccount } from './types.cjs'
interface BiliDynamic {
  type?: string
  modules?: {
    module_author?: { mid?: string | number; name?: string; pub_ts?: number }
    module_dynamic?: {
      major?: {
        archive?: {
          bvid?: string
          title?: string
          desc?: string
          cover?: string
          duration_text?: string
        }
      }
    }
  }
}
interface BiliResponse {
  code: number
  data: {
    isLogin?: boolean
    mid?: string | number
    uname?: string
    list?: Array<{ mid: string | number; uname?: string; sign?: string }>
    total?: number
    items?: BiliDynamic[]
    offset?: string
    has_more?: boolean
  }
}
import { errorMessage } from './types.cjs'
const API = 'https://api.bilibili.com'

function normalizeVideo(item: BiliDynamic): Video | null {
  const author = item.modules?.module_author
  const archive = item.modules?.module_dynamic?.major?.archive
  if (item.type !== 'DYNAMIC_TYPE_AV' || !archive?.bvid || !author?.mid) {
    return null
  }
  if (!/^BV[A-Za-z0-9]+$/.test(archive.bvid)) {
    return null
  }
  let cover: string | undefined
  try {
    const url = new URL(String(archive.cover || '').replace(/^http:/, 'https:'))
    if (
      url.protocol === 'https:' &&
      url.hostname.endsWith('.hdslb.com') &&
      !url.username &&
      !url.password
    ) {
      cover = url.href
    }
  } catch {
    /* A missing cover must not suppress the video. */
  }
  return {
    id: archive.bvid,
    authorId: String(author.mid),
    author: String(author.name || '').slice(0, 100),
    title: String(archive.title || '').slice(0, 300),
    description: String(archive.desc || '').slice(0, 1200),
    publishedAt: Number(author.pub_ts) * 1000,
    url: `https://www.bilibili.com/video/${archive.bvid}`,
    cover,
    duration: /^[0-9:]{1,12}$/.test(archive.duration_text || '')
      ? archive.duration_text
      : undefined,
  }
}

class Bilibili {
  loginWindow: ElectronBrowserWindow | null = null
  constructor(
    public session: Session,
    public BrowserWindow: typeof ElectronBrowserWindow,
  ) {
    this.session.setPermissionRequestHandler?.((_contents, _permission, callback) =>
      callback(false),
    )
    this.session.setPermissionCheckHandler?.(() => false)
  }

  async request(
    path: string,
    parameters: Record<string, string | number> = {},
    signal?: AbortSignal,
  ) {
    const url = new URL(path, API)
    url.search = new URLSearchParams(
      Object.entries(parameters).map(([key, value]) => [key, String(value)]),
    ).toString()
    let response
    try {
      response = await this.session.fetch(url.href, {
        method: 'GET',
        credentials: 'include',
        redirect: 'error',
        headers: { Referer: 'https://www.bilibili.com/', Accept: 'application/json' },
        signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
      })
    } catch {
      throw new Error('B 站连接失败或超时，请检查网络后重试')
    }
    if (!response.ok) {
      throw new Error(`B 站返回 HTTP ${response.status}，请稍后重试`)
    }
    const body = (await response.json().catch(() => null)) as BiliResponse | null
    if (!body || typeof body.code !== 'number') {
      throw new Error('B 站返回格式已变化，暂时无法读取')
    }
    if ([-101, -6, 4100000].includes(body.code)) {
      throw new Error('B 站登录已失效，请重新登录')
    }
    if (body.code !== 0) {
      throw new Error(`B 站暂时拒绝读取（${body.code}），请在登录窗口检查账号状态后重试`)
    }
    return body.data
  }

  async account(signal?: AbortSignal): Promise<BiliAccount> {
    try {
      const data = await this.request('/x/web-interface/nav', {}, signal)
      if (!data?.isLogin || !data.mid) {
        return { loggedIn: false }
      }
      return { loggedIn: true, mid: String(data.mid), name: String(data.uname || '') }
    } catch (error) {
      if (errorMessage(error).includes('登录已失效')) {
        return { loggedIn: false }
      }
      throw error
    }
  }

  async requireAccount(expected?: string, signal?: AbortSignal) {
    const account = await this.account(signal)
    if (!account.loggedIn) {
      throw new Error('请先在 B 站插件中登录账号')
    }
    if (expected && expected !== account.mid) {
      throw new Error('当前 B 站账号与订阅账号不同，请切换回原账号或重新选择订阅')
    }
    return account
  }

  login() {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.show()
      this.loginWindow.focus()
      return
    }
    const loginWindow = new this.BrowserWindow({
      width: 1000,
      height: 760,
      title: 'B 站登录 · DingDong Studio',
      webPreferences: {
        session: this.session,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })
    this.loginWindow = loginWindow
    loginWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const limitNavigation = (event: Electron.Event, destination: string) => {
      try {
        const url = new URL(destination)
        if (
          url.protocol !== 'https:' ||
          !(url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com'))
        ) {
          event.preventDefault()
        }
      } catch {
        event.preventDefault()
      }
    }
    loginWindow.webContents.on('will-navigate', limitNavigation)
    loginWindow.webContents.on('will-redirect', limitNavigation)
    loginWindow.on('closed', () => {
      this.loginWindow = null
    })
    return loginWindow.loadURL('https://passport.bilibili.com/login').catch((error) => {
      // The login site may replace its initial navigation with a regional URL.
      if (error.code !== 'ERR_ABORTED') {
        throw new Error('B 站登录页未能加载，请检查网络后重新打开')
      }
    })
  }

  async logout() {
    this.loginWindow?.close()
    await this.session.clearStorageData()
    await this.session.clearCache()
  }

  async followings(input: { accountMid?: string; page?: number } = {}) {
    const account = await this.requireAccount(input.accountMid)
    const page = Number(input.page || 1)
    if (!Number.isInteger(page) || page < 1 || page > 200) {
      throw new Error('关注列表页码无效')
    }
    const data = await this.request('/x/relation/followings', {
      vmid: account.mid!,
      pn: page,
      ps: 50,
      order: 'desc',
    })
    if (!Array.isArray(data?.list)) {
      throw new Error('无法读取关注列表，请检查账号的访问权限')
    }
    const users = data.list.map((user) => ({
      mid: String(user.mid),
      name: String(user.uname || ''),
      description: String(user.sign || '').slice(0, 200),
    }))
    return {
      account,
      users,
      total: Number(data.total || 0),
      page,
      hasMore: users.length === 50 && page * 50 < Number(data.total),
    }
  }

  async feed(input: BiliFeedInput, signal?: AbortSignal): Promise<BiliFeed> {
    await this.requireAccount(input.accountMid, signal)
    const since = Number(input.since)
    if (!Number.isFinite(since) || since < 0) {
      throw new Error('视频检查时间无效')
    }
    let offset = ''
    const videos = new Map<string, Video>()
    const maximumPages = input.preview ? 2 : 5
    for (let page = 0; page < maximumPages; page++) {
      const data = await this.request(
        '/x/polymer/web-dynamic/v1/feed/all',
        { type: 'video', ...(offset ? { offset } : {}) },
        signal,
      )
      if (!Array.isArray(data?.items)) {
        throw new Error('B 站未返回视频动态列表，请重新登录或稍后重试')
      }
      const batch = data.items.map(normalizeVideo).filter((video): video is Video => video !== null)
      for (const video of batch) {
        if (Number.isFinite(video.publishedAt) && video.publishedAt >= since) {
          videos.set(video.id, video)
        }
      }
      const passedBoundary = batch.some((video) => video.publishedAt < since)
      if (passedBoundary || !data.has_more) {
        return { videos: [...videos.values()], complete: true }
      }
      if (!data.offset || data.offset === offset) {
        throw new Error('B 站分页读取未能继续，请稍后重试')
      }
      offset = data.offset
    }
    if (input.preview) {
      return { videos: [...videos.values()], complete: false }
    }
    throw new Error('待检查的视频动态超过 5 页，本次未推进记录。请缩短检查间隔，或重新建立任务基线')
  }
}

export { Bilibili, normalizeVideo }
