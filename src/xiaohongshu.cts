import { watchSearch, type SearchOutcome } from './xhs-search.cjs'
import type { BrowserWindow as Window, Session } from 'electron'
import type {
  XHSAccount,
  XHSInput,
  XHSSearchInput,
  XHSDetailInput,
  XHSFeed,
  XHSNote,
} from './xhs-types.cjs'
import { xhsAccount, xhsNotes, xhsNote, xhsURL } from './xhs-parser.cjs'

const readState = `(() => {
  const unwrap = value => value && typeof value === 'object' ? (value.value ?? value._value ?? value) : value;
  const state = window.__INITIAL_STATE__ || {};
  const user = unwrap(state.user?.userInfo);
  return JSON.stringify({account: user ? {userId:user.userId || user.user_id,nickname:user.nickname,guest:user.guest}:null,
    feed:unwrap(state.feed?.feeds), search:unwrap(state.search?.feeds), searchState:unwrap(state.search?.state), searchKeyword:unwrap(state.search?.searchContext)?.keyword, path:location.pathname, detail:unwrap(state.note?.noteDetailMap),
    blocked:!!document.querySelector('.captcha-container, #captcha-box')});
})()`
interface PageState {
  account?: unknown
  feed?: unknown
  search?: unknown
  searchState?: string
  searchKeyword?: string
  path?: string
  detail?: Record<string, { note?: unknown }>
  blocked?: boolean
}
export class Xiaohongshu {
  private ready: Promise<void>
  private loginWindow: Window | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private generation = 0
  private active = new Set<AbortController>()
  constructor(
    private session: Session,
    private BrowserWindow: typeof Window,
  ) {
    // Domestic XHS redirects proxy exits overseas to a different account service.
    this.ready = session.setProxy({ mode: 'direct' })
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    session.setPermissionCheckHandler(() => false)
    session.on('will-download', (event) => event.preventDefault())
  }
  private window(show: boolean): Window {
    const win = new this.BrowserWindow({
      width: 1100,
      height: 820,
      show,
      title: '小红书登录 · DingDong Studio',
      webPreferences: {
        session: this.session,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    })
    win.webContents.setUserAgent(
      win.webContents
        .getUserAgent()
        .replace(/\s(?:Electron|MiniPush|MiniPush Helper)\/[^\s]+/g, ''),
    )
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const navigation = (event: Electron.Event, address: string) => {
      try {
        const url = new URL(address)
        if (
          url.protocol !== 'https:' ||
          !(url.hostname === 'xiaohongshu.com' || url.hostname.endsWith('.xiaohongshu.com'))
        )
          event.preventDefault()
      } catch {
        event.preventDefault()
      }
    }
    win.webContents.on('will-navigate', navigation)
    win.webContents.on('will-redirect', navigation)
    return win
  }
  async login(): Promise<void> {
    await this.ready
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.show()
      this.loginWindow.focus()
      if (!this.loginWindow.webContents.getURL())
        await this.loginWindow.loadURL('https://www.xiaohongshu.com/explore')
      return
    }
    const win = this.window(true)
    this.loginWindow = win
    win.on('closed', () => {
      this.loginWindow = null
      void this.session.cookies.flushStore()
    })
    await win.loadURL('https://www.xiaohongshu.com/explore')
  }
  private async state(win: Window): Promise<PageState | null> {
    const raw = await win.webContents.executeJavaScript(readState)
    if (typeof raw !== 'string') return null
    if (raw.length > 8000000) throw new Error('小红书页面数据过大')
    return JSON.parse(raw) as PageState
  }
  private async read<T>(
    url: string,
    extract: (state: PageState, search: SearchOutcome) => T | undefined,
    signal?: AbortSignal,
    searchQuery?: string,
  ): Promise<T> {
    const generation = this.generation
    const run = async () => {
      if (generation !== this.generation) throw new Error('小红书读取已取消')
      await this.ready
      signal?.throwIfAborted()
      const controller = new AbortController()
      this.active.add(controller)
      const combined = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(45000),
        ...(signal ? [signal] : []),
      ])
      const win = this.window(false)
      const cancel = () => {
        if (!win.isDestroyed()) win.destroy()
      }
      combined.addEventListener('abort', cancel, { once: true })
      let monitor: Awaited<ReturnType<typeof watchSearch>> | undefined
      try {
        if (searchQuery) {
          // Initialize the renderer before CDP commands; an uninitialized hidden window
          // cannot answer Network.enable, so awaiting it would block navigation.
          await win.loadURL('about:blank')
          monitor = await watchSearch(win.webContents, searchQuery)
        }
        combined.throwIfAborted()
        await win.loadURL(url)
        while (!combined.aborted) {
          const state = await this.state(win)
          if (
            state?.blocked ||
            /^\/(?:website-login|login|web-login|captcha|website-captcha)(?:\/|$)/.test(
              state?.path || '',
            )
          )
            throw new Error('小红书需要验证，请打开登录窗口处理后重试')
          if (state) {
            const result = extract(state, monitor?.result() || {})
            if (result !== undefined) return result
          }
          await new Promise((resolve) => setTimeout(resolve, 300))
        }
        throw new Error('小红书读取超时，请检查登录或稍后重试')
      } catch (error) {
        if (signal?.aborted || controller.signal.aborted) throw new Error('小红书读取已取消')
        if (combined.aborted) throw new Error('小红书读取超时，请检查网络或稍后重试')
        if (error instanceof Error && error.message.startsWith('小红书')) throw error
        throw new Error('小红书页面读取失败，请打开登录窗口检查网络或验证状态', { cause: error })
      } finally {
        monitor?.stop()
        combined.removeEventListener('abort', cancel)
        cancel()
        this.active.delete(controller)
      }
    }
    const pending = this.queue.then(run, run)
    this.queue = pending.catch(() => undefined)
    return pending
  }
  async account(): Promise<XHSAccount> {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      const state = await this.state(this.loginWindow)
      return xhsAccount(state?.account)
    }
    return this.read('https://www.xiaohongshu.com/explore', (state) =>
      state.account != null ? xhsAccount(state.account) : undefined,
    )
  }
  async logout(): Promise<void> {
    this.generation++
    for (const controller of this.active) controller.abort()
    if (this.loginWindow && !this.loginWindow.isDestroyed()) this.loginWindow.destroy()
    await this.queue
    await this.session.clearStorageData()
    await this.session.cookies.flushStore()
  }
  private requireAccount(state: PageState, expected: string) {
    if (!/^[a-f0-9]{24}$/i.test(expected)) throw new Error('小红书账号未配置，请先登录')
    const account = xhsAccount(state.account)
    if (!account.loggedIn) throw new Error('小红书登录已失效，请在官方窗口重新登录')
    if (account.id !== expected) throw new Error('小红书当前账号与任务不同，请重新配置任务')
  }
  async feed(input: XHSInput, signal?: AbortSignal): Promise<XHSFeed> {
    return this.read(
      'https://www.xiaohongshu.com/explore',
      (state) => {
        if (state.account == null) return undefined
        this.requireAccount(state, input.accountId)
        return state.feed === undefined
          ? undefined
          : {
              notes: xhsNotes(state.feed),
              scope: '推荐流首屏最多 30 篇，不是关注流，也不覆盖全部笔记',
            }
      },
      signal,
    )
  }
  async search(input: XHSSearchInput, signal?: AbortSignal): Promise<XHSFeed> {
    if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 80)
      throw new Error('小红书搜索词需为 1–80 字')
    const url = new URL('https://www.xiaohongshu.com/search_result/')
    url.searchParams.set('keyword', input.query.trim())
    url.searchParams.set('source', 'web_explore_feed')
    url.searchParams.set('type', '51')
    return this.read(
      url.href,
      (state, outcome) => {
        if (state.account == null) return undefined
        this.requireAccount(state, input.accountId)
        if (outcome.error) throw new Error(outcome.error)
        if (state.searchKeyword !== undefined && state.searchKeyword !== input.query.trim())
          return undefined
        if (state.searchState === 'loading' || !Array.isArray(state.search)) return undefined
        if (!state.search.length && !outcome.empty) return undefined
        if (state.search.length && state.searchState === 'error') return undefined
        return {
          notes: xhsNotes(state.search),
          scope: '综合搜索首屏最多 30 篇，不保证时间排序或全量覆盖',
        }
      },
      signal,
      input.query.trim(),
    )
  }
  async detail(input: XHSDetailInput, signal?: AbortSignal): Promise<XHSNote> {
    const url = xhsURL(input.id, input.token)
    return this.read(
      url,
      (state) => {
        if (state.account == null) return undefined
        this.requireAccount(state, input.accountId)
        const note = state.detail?.[input.id]?.note
        if (!note) return undefined
        const result = xhsNote(note, input.token)
        if (!result || result.id !== input.id) throw new Error('小红书笔记详情无法识别')
        return result
      },
      signal,
    )
  }
}
