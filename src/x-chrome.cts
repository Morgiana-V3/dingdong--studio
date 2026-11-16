import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, type Browser, type BrowserContext } from 'playwright-core'

// Login uses the app-owned profile; everyday Chrome requires explicit authorized import.
export class XChrome {
  private browser?: Browser
  private starting?: Promise<BrowserContext>
  private flag: string
  readonly profile: string
  constructor(dataDirectory: string) {
    this.profile = path.join(dataDirectory, 'x-chrome')
    this.flag = path.join(dataDirectory, 'x-chrome-enabled')
  }
  get enabled() {
    return fs.existsSync(this.flag)
  }
  private async existing(): Promise<Browser | undefined> {
    try {
      const [port, endpoint] = fs
        .readFileSync(path.join(this.profile, 'DevToolsActivePort'), 'utf8')
        .trim()
        .split('\n')
      if (!/^\d{1,5}$/.test(port) || !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(endpoint)) {
        return undefined
      }
      return await chromium.connectOverCDP(`ws://127.0.0.1:${port}${endpoint}`, {
        timeout: 5000,
        noDefaults: true,
      })
    } catch {
      return undefined
    }
  }
  private launch(): void {
    const executable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    if (!fs.existsSync(executable)) {
      throw new Error('未找到 Google Chrome，请安装到「应用程序」后重试')
    }
    fs.mkdirSync(this.profile, { recursive: true, mode: 0o700 })
    const child = spawn(
      executable,
      [
        `--user-data-dir=${this.profile}`,
        '--remote-debugging-port=0',
        '--remote-debugging-address=127.0.0.1',
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
      ],
      { detached: true, stdio: 'ignore' },
    )
    child.on('error', () => undefined)
    child.unref()
  }
  private async connect(): Promise<BrowserContext> {
    let browser = this.browser?.isConnected() ? this.browser : await this.existing()
    if (!browser) {
      this.launch()
      for (let attempt = 0; attempt < 40; attempt++) {
        await delay(250)
        browser = await this.existing()
        if (browser) {
          break
        }
      }
      if (!browser) {
        throw new Error('Chrome 连接未就绪，请关闭 DingDong Studio 专用 Chrome 后重试')
      }
    }
    this.browser = browser
    const context = browser.contexts()[0]
    // Chrome on macOS can keep the process alive after unloading its last profile.
    // A real tab must load the dedicated profile before Storage/cookie APIs work.
    if (!context.pages().length) {
      this.launch()
      for (let attempt = 0; attempt < 40 && !context.pages().length; attempt++) {
        await delay(250)
      }
      if (!context.pages().length) {
        throw new Error('Chrome 配置尚未载入，请打开专用登录窗口后重试')
      }
    }
    return context
  }
  private context(): Promise<BrowserContext> {
    if (!this.starting) {
      this.starting = this.connect().finally(() => {
        this.starting = undefined
      })
    }
    return this.starting
  }
  async login(): Promise<void> {
    const context = await this.context()
    fs.writeFileSync(this.flag, 'chrome\n', { mode: 0o600 })
    const existing = context.pages().find((page) => page.url().startsWith('https://x.com/'))
    if (existing) {
      await existing.bringToFront()
      return
    }
    const page = await context.newPage()
    await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.bringToFront()
  }
  async importSession(): Promise<Array<{ name: string; value: string }>> {
    let source: Browser | undefined
    try {
      source = await chromium.connectOverCDP('chrome', { timeout: 60000, noDefaults: true })
      const cookies = await source.contexts()[0].cookies('https://x.com')
      const required = ['auth_token', 'ct0', 'twid']
      if (
        required.some((name) => !cookies.some((cookie) => cookie.name === name && cookie.value))
      ) {
        throw new Error(
          '已连接的 Chrome 配置中没有完整 X 登录，请确认授权的是已登录 X 的浏览器配置',
        )
      }
      return cookies
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('已连接')) {
        throw error
      }
      throw new Error(
        '未能导入 Chrome 登录。请在常用 Chrome 打开 chrome://inspect/#remote-debugging，开启连接并在弹窗中允许，然后重试。',
      )
    } finally {
      await source?.close().catch(() => undefined)
    }
  }
  async cookies(): Promise<Array<{ name: string; value: string }>> {
    return (await this.context()).cookies('https://x.com')
  }
  disable(): void {
    fs.rmSync(this.flag, { force: true })
  }
}
