import type { HostMessage, PluginContext, PluginModule } from './types.cjs'
import { errorMessage } from './types.cjs'
const parentPort = process.parentPort!
const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
let requestId = 0

function request<T>(type: string, payload: Record<string, unknown>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = ++requestId
    waiting.set(id, { resolve: (value) => resolve(value as T), reject })
    parentPort.postMessage({ type, id, ...payload })
  })
}

parentPort.on('message', async ({ data }: { data: HostMessage }) => {
  if (data.type === 'reply') {
    const pending = waiting.get(data.id)
    if (!pending) {
      return
    }
    waiting.delete(data.id)
    if (data.error) {
      pending.reject(new Error(data.error))
    } else {
      pending.resolve(data.value)
    }
    return
  }
  if (data.type !== 'run') {
    return
  }
  const context: PluginContext = {
    task: data.task,
    config: data.config,
    state: data.state,
    now: data.now,
    sources: {
      xiaohongshu: {
        feed: (input) => request('xiaohongshu', { input, action: 'feed' }),
        search: (input) => request('xiaohongshu', { input, action: 'search' }),
        detail: (input) => request('xiaohongshu', { input, action: 'detail' }),
      },
      x: {
        following(input) {
          return request('x', { input, action: 'following' })
        },
        search(input) {
          return request('x', { input, action: 'search' })
        },
        detail(input) {
          return request('x', { input, action: 'detail' })
        },
      },
      tieba: {
        search(input) {
          return request('tieba', { input, action: 'search' })
        },
        post(input) {
          return request('tieba', { input, action: 'post' })
        },
        feed(input) {
          return request('tieba', { input })
        },
      },
      bilibili: {
        feed(input) {
          return request('bilibili', { input })
        },
      },
    },
    log(event) {
      parentPort.postMessage({ type: 'trace', event })
    },
    ai: {
      respond(input) {
        return request('ai-tools', { input })
      },
      generate(prompt) {
        return request<string>('ai', { prompt })
      },
    },
  }
  try {
    const plugin: PluginModule = require(data.entry)
    if (typeof plugin.run !== 'function') {
      throw new Error('插件必须导出 run(context)')
    }
    const output = await plugin.run(context)
    parentPort.postMessage({ type: 'done', output })
  } catch (error) {
    parentPort.postMessage({ type: 'error', error: errorMessage(error) })
  }
})
