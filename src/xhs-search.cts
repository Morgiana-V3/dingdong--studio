import type { WebContents } from 'electron'
export interface SearchOutcome {
  empty?: boolean
  error?: string
}
export function searchOutcome(value: unknown): SearchOutcome {
  const body = value as {
    code?: unknown
    success?: unknown
    data?: { items?: unknown; has_more?: unknown }
  } | null
  if (!body || body.code !== 0 || body.success !== true || !body.data)
    return { error: '小红书搜索接口未成功，请打开登录窗口检查验证状态' }
  if (Array.isArray(body.data.items) && body.data.items.length) return {}
  if (
    (body.data.items === undefined || Array.isArray(body.data.items)) &&
    body.data.has_more === false
  )
    return { empty: true }
  return { error: '小红书搜索没有返回可确认的结果' }
}
// Observe only the current keyword's first page. Never replay requests or read cookies.
export async function watchSearch(contents: WebContents, query: string) {
  const debuggerAPI = contents.debugger
  let requestId = ''
  let status = 0
  let outcome: SearchOutcome = {}
  let stopped = false
  debuggerAPI.attach('1.3')
  const listener = (_event: Electron.Event, method: string, params: Record<string, unknown>) => {
    void (async () => {
      if (method === 'Network.requestWillBeSent') {
        const request = params.request as { url?: string; method?: string; postData?: string }
        if (!request?.url || request.method !== 'POST') return
        const url = new URL(request.url)
        if (
          !url.hostname.endsWith('.xiaohongshu.com') ||
          !/^\/api\/sns\/web\/v[12]\/search\/notes$/.test(url.pathname)
        )
          return
        let body = request.postData
        if (!body)
          body = (
            await debuggerAPI.sendCommand('Network.getRequestPostData', {
              requestId: params.requestId,
            })
          ).postData
        const data = JSON.parse(body || '{}') as { keyword?: string; page?: number }
        if (data.keyword === query && data.page === 1 && !stopped) {
          requestId = String(params.requestId)
          status = 0
          outcome = {}
        }
        return
      }
      if (!requestId || params.requestId !== requestId || stopped) return
      if (method === 'Network.responseReceived')
        status = Number((params.response as { status?: number })?.status || 0)
      if (method === 'Network.loadingFailed') outcome = { error: '小红书搜索网络请求失败' }
      if (method === 'Network.loadingFinished') {
        if (status < 200 || status >= 300) {
          outcome = { error: `小红书搜索请求失败（HTTP ${status}）` }
          return
        }
        const current = requestId
        const response = (await debuggerAPI.sendCommand('Network.getResponseBody', {
          requestId: current,
        })) as { body: string; base64Encoded?: boolean }
        if (current !== requestId || stopped) return
        if (typeof response.body !== 'string' || response.body.length > 8000000) {
          outcome = { error: '小红书搜索响应过大' }
          return
        }
        const raw = response.base64Encoded
          ? Buffer.from(response.body, 'base64').toString('utf8')
          : response.body
        outcome = searchOutcome(JSON.parse(raw))
      }
    })().catch(() => {
      if (!stopped) outcome = { error: '小红书搜索响应无法读取，请稍后重试' }
    })
  }
  debuggerAPI.on('message', listener)
  try {
    await debuggerAPI.sendCommand('Network.enable')
  } catch (error) {
    debuggerAPI.removeListener('message', listener)
    debuggerAPI.detach()
    throw error
  }
  return {
    result: () => outcome,
    stop: () => {
      stopped = true
      debuggerAPI.removeListener('message', listener)
      if (!contents.isDestroyed() && debuggerAPI.isAttached()) debuggerAPI.detach()
    },
  }
}
