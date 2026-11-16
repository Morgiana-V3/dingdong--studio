import { Agent, ProxyAgent, setGlobalDispatcher } from 'undici'
import { XHTTPClient } from './x-http-client.cjs'
import type { XHTTPJob } from './x-http.cjs'

const port = process.parentPort!
let client: XHTTPClient | undefined
let proxy: string | undefined
let dispatcher: Agent | ProxyAgent | undefined
port.on('message', async ({ data }: { data: XHTTPJob }) => {
  try {
    if (!client || proxy !== data.proxy) {
      proxy = data.proxy
      await dispatcher?.close()
      dispatcher = proxy ? new ProxyAgent(proxy) : new Agent()
      setGlobalDispatcher(dispatcher)
      client = new XHTTPClient(data.cacheFile)
    }
    const value = await client.request(data.operation, data.variables, data.cookies)
    port.postMessage({ id: data.id, value })
  } catch (error) {
    // Errors from libraries can contain request details; only our messages cross IPC.
    const detail = error instanceof Error ? error.message : ''
    port.postMessage({
      id: data.id,
      error: /^(X |无法更新 X)/.test(detail)
        ? detail
        : 'X 后台请求失败，请检查系统代理、网络或接口适配',
    })
  }
})
