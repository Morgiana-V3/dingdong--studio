import path from 'node:path'
import type { UtilityProcess, utilityProcess } from 'electron'
import type { XCookie } from './x-credentials.cjs'
import type { XOperation } from './x-http-client.cjs'

export interface XHTTPJob {
  id: number
  operation: XOperation
  variables: Record<string, unknown>
  cookies: XCookie[]
  proxy: string
  cacheFile: string
}
export interface XHTTPTransport {
  request(
    operation: XOperation,
    variables: Record<string, unknown>,
    cookies: XCookie[],
    signal: AbortSignal,
  ): Promise<unknown>
  stop(): void
}
export function httpProxy(value: string): string {
  const first = value.split(';')[0].trim()
  if (first === 'DIRECT') {
    return ''
  }
  const match = /^(PROXY|HTTPS) ([\w.\-\[\]:]+)$/.exec(first)
  if (!match) {
    throw new Error('X 后台请求需要 HTTP/HTTPS 系统代理；当前代理类型暂不支持')
  }
  return `${match[1] === 'HTTPS' ? 'https' : 'http'}://${match[2]}`
}
export class XHTTP implements XHTTPTransport {
  private child?: UtilityProcess
  private sequence = 0
  private pending?: { reject(error: Error): void }
  constructor(
    private directory: string,
    private utility: typeof utilityProcess,
    private resolveProxy: (url: string) => Promise<string>,
  ) {}
  stop(): void {
    this.pending?.reject(new Error('X 读取已取消'))
    this.child?.kill()
    this.child = undefined
  }
  async request(
    operation: XOperation,
    variables: Record<string, unknown>,
    cookies: XCookie[],
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted()
    const proxy = httpProxy(await this.resolveProxy('https://x.com'))
    signal.throwIfAborted()
    if (this.pending) {
      throw new Error('X 后台读取正在执行')
    }
    if (!this.child) {
      this.child = this.utility.fork(path.join(__dirname, 'x-http-worker.cjs'), [], {
        stdio: 'ignore',
        env: { PATH: process.env.PATH, LANG: 'zh_CN.UTF-8' },
      })
      const started = this.child
      started.once('exit', () => {
        if (this.child === started) {
          this.child = undefined
        }
      })
    }
    const child = this.child
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      let finished = false
      const finish = (error?: Error, value?: unknown) => {
        if (finished) {
          return
        }
        finished = true
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        child.removeListener('message', message)
        child.removeListener('exit', exited)
        this.pending = undefined
        if (error) {
          reject(error)
        } else {
          resolve(value)
        }
      }
      const abort = () => {
        finish(new Error('X 读取已取消'))
        this.stop()
      }
      const exited = () => {
        this.child = undefined
        finish(new Error('X 后台读取进程退出，请重试'))
      }
      const message = (result: { id: number; error?: string; value?: unknown }) => {
        if (result.id !== id) {
          return
        }
        finish(result.error ? new Error(result.error) : undefined, result.value)
      }
      const timer = setTimeout(() => {
        finish(new Error('X 后台读取超时，请检查网络或代理'))
        this.stop()
      }, 90000)
      this.pending = { reject: (error) => finish(error) }
      signal.addEventListener('abort', abort, { once: true })
      child.on('exit', exited)
      child.on('message', message)
      try {
        child.postMessage({
          id,
          operation,
          variables,
          cookies,
          proxy,
          cacheFile: path.join(this.directory, 'x-api-cache.json'),
        } satisfies XHTTPJob)
      } catch {
        finish(new Error('X 后台读取进程不可用，请重试'))
        this.stop()
      }
    })
  }
}
