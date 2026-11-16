import type { BrowserWindow as Window, Session } from 'electron'
import type { XAccount, XSearchInput, XSearchResult, XDetailInput, XDetail } from './x-types.cjs'
import type { XCredentialStore, XCookie } from './x-credentials.cjs'
import type { XHTTPTransport } from './x-http.cjs'
import type { XOperation } from './x-http-client.cjs'
import type { XChrome } from './x-chrome.cjs'
import { parseXTimeline } from './x-parser.cjs'

export class XSourceService {
  loginWindow: Window | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private pendingLogin = false
  private active = new Set<AbortController>()

  constructor(
    public session: Session,
    public BrowserWindow: typeof Window,
    private chrome: XChrome | undefined,
    private http: XHTTPTransport,
    private credentials: XCredentialStore,
  ) {
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    session.setPermissionCheckHandler(() => false)
    session.on('will-download', (event) => event.preventDefault())
  }

  private createWindow(show: boolean): Window {
    const window = new this.BrowserWindow({
      width: 1100,
      height: 820,
      show,
      title: 'X 登录 · DingDong Studio',
      webPreferences: {
        session: this.session,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    })
    window.webContents.setUserAgent(
      window.webContents
        .getUserAgent()
        .replace(/\s(?:Electron|MiniPush|MiniPush Helper)\/[^\s]+/g, ''),
    )
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const navigate = (event: Electron.Event, destination: string) => {
      try {
        const url = new URL(destination)
        if (
          url.protocol !== 'https:' ||
          !['x.com', 'twitter.com'].some(
            (host) => url.hostname === host || url.hostname.endsWith('.' + host),
          )
        ) {
          event.preventDefault()
        }
      } catch {
        event.preventDefault()
      }
    }
    window.webContents.on('will-navigate', navigate)
    window.webContents.on('will-redirect', navigate)
    return window
  }

  async account(): Promise<XAccount> {
    const cookies = this.credentials.load()
    const auth = cookies.find((cookie) => cookie.name === 'auth_token')
    const rawId = cookies.find((cookie) => cookie.name === 'twid')?.value || ''
    let id = ''
    try {
      id = decodeURIComponent(rawId).match(/^u=(\d+)$/)?.[1] || ''
    } catch {
      /* Incomplete login. */
    }
    return auth?.value && id ? { hasSession: true, id } : { hasSession: false }
  }

  async importChromeSession(): Promise<void> {
    if (!this.chrome) {
      throw new Error('Chrome 登录服务未配置')
    }
    for (const controller of this.active) {
      controller.abort()
    }
    this.credentials.save(await this.chrome.importSession())
    this.pendingLogin = false
    this.http.stop()
  }
  async refreshSession(): Promise<XAccount> {
    if (!this.pendingLogin && this.credentials.load().length) {
      return this.account()
    }
    let cookies: XCookie[]
    if (this.chrome?.enabled) {
      cookies = await this.chrome.cookies()
    } else {
      cookies = await this.session.cookies.get({ url: 'https://x.com' })
    }
    if (cookies.some((cookie) => cookie.name === 'auth_token')) {
      this.credentials.save(cookies)
      this.pendingLogin = false
    }
    return this.account()
  }
  async loginChrome(): Promise<void> {
    if (!this.chrome) {
      throw new Error('Chrome 登录服务未配置')
    }
    for (const controller of this.active) {
      controller.abort()
    }
    this.loginWindow?.destroy()
    this.pendingLogin = true
    await this.chrome.login()
  }

  async login(): Promise<void> {
    this.pendingLogin = true
    if (this.chrome?.enabled) {
      return this.chrome.login()
    }
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.show()
      this.loginWindow.focus()
      return
    }
    const window = this.createWindow(true)
    this.loginWindow = window
    window.on('closed', () => {
      this.loginWindow = null
    })
    const account = await this.account()
    await window
      .loadURL(account.hasSession ? 'https://x.com/home' : 'https://x.com/i/flow/login')
      .catch((error: Error & { code?: string }) => {
        if (error.code !== 'ERR_ABORTED') {
          throw new Error('X 登录页未能加载，请检查系统网络或代理后重试')
        }
      })
  }

  stop(): void {
    for (const controller of this.active) {
      controller.abort()
    }
    this.http.stop()
  }

  async logout(): Promise<void> {
    this.pendingLogin = false
    for (const controller of this.active) {
      controller.abort()
    }
    this.loginWindow?.destroy()
    this.http.stop()
    this.credentials.clear()
    this.chrome?.disable()
    await this.session.clearStorageData()
    await this.session.clearCache()
  }

  private async requireAccount(expected: string): Promise<void> {
    const account = await this.account()
    if (!account.hasSession) {
      throw new Error('请先在 X 插件中完成登录')
    }
    if (account.id !== expected) {
      throw new Error('当前 X 账号与任务账号不同，请重新配置任务或切换回原账号')
    }
  }

  private read(
    operation: XOperation,
    variables: Record<string, unknown>,
    accountId: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const controller = new AbortController()
    this.active.add(controller)
    const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])])
    const operationResult = this.queue
      .then(async () => {
        combined.throwIfAborted()
        await this.requireAccount(accountId)
        return this.http.request(operation, variables, this.credentials.load(), combined)
      })
      .finally(() => this.active.delete(controller))
    this.queue = operationResult.catch(() => undefined)
    return operationResult
  }

  async following(input: { accountId: string }, signal?: AbortSignal): Promise<XSearchResult> {
    const body = await this.read(
      'HomeLatestTimeline',
      {
        count: 40,
        includePromotedContent: false,
        latestControlAvailable: true,
        requestContext: 'launch',
        withCommunity: true,
        seenTweetIds: [],
      },
      input.accountId,
      signal,
    )
    return {
      posts: parseXTimeline(body, 'following').slice(0, 40),
      query: '',
      scope: '关注时间线首批，最多 40 条；排除广告与转推，不覆盖全部更新',
    }
  }

  async search(input: XSearchInput, signal?: AbortSignal): Promise<XSearchResult> {
    if (
      typeof input.query !== 'string' ||
      !input.query.trim() ||
      input.query.length > 300 ||
      !['Latest', 'Top'].includes(input.sort)
    ) {
      throw new Error('搜索词需为 1–300 字，排序仅支持最新或热门')
    }
    const body = await this.read(
      'SearchTimeline',
      { rawQuery: input.query.trim(), count: 30, querySource: 'typed_query', product: input.sort },
      input.accountId,
      signal,
    )
    return {
      posts: parseXTimeline(body, 'search').slice(0, 30),
      query: input.query.trim(),
      scope: '后台接口首批结果，最多 30 条；不代表完整或实时全量结果',
    }
  }

  async detail(input: XDetailInput, signal?: AbortSignal): Promise<XDetail> {
    if (!/^\d{1,25}$/.test(input.id)) {
      throw new Error('帖子编号无效')
    }
    const body = await this.read(
      'TweetDetail',
      {
        focalTweetId: input.id,
        with_rux_injections: false,
        rankingMode: 'Relevance',
        includePromotedContent: false,
        withCommunity: true,
        withQuickPromoteEligibilityTweetFields: false,
        withBirdwatchNotes: true,
        withVoice: true,
      },
      input.accountId,
      signal,
    )
    const posts = parseXTimeline(body, 'detail')
    const post = posts.find((item) => item.id === input.id)
    if (!post) {
      throw new Error('X 原帖不可读取，可能已删除或权限受限')
    }
    const thread = posts
      .filter(
        (item) =>
          item.id !== post.id &&
          item.authorId === post.authorId &&
          item.conversationId === post.conversationId &&
          Boolean(post.conversationId),
      )
      .slice(0, 8)
    return {
      post,
      thread,
      scope: '原帖与本次响应中同作者的讨论串片段；不读取他人评论，不保证讨论串完整',
    }
  }
}
