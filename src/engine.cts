import type { Store } from './store.cjs'
import type { Plugins } from './plugins.cjs'
import type { Services } from './services.cjs'
import type {
  InstalledPlugin,
  Task,
  Trace,
  PluginResult,
  RunRecord,
  Capability,
  WorkerMessage,
} from './types.cjs'
import {
  DIGEST_ID,
  digestOwner,
  digestSources,
  combineMessages,
  validateOutput,
} from './digest.cjs'
import { errorMessage } from './types.cjs'
import path from 'node:path'
import crypto from 'node:crypto'
import { nextRun, messageDigest } from './domain.cjs'

class Engine {
  running = new Map<string, AbortController>()
  timer?: ReturnType<typeof setInterval>
  constructor(
    public store: Store,
    public plugins: Plugins,
    public services: Services,
    public utilityProcess: typeof import('electron').utilityProcess,
    public changed: () => void,
  ) {}

  start() {
    this.timer = setInterval(() => this.tick(), 5000)
    this.tick()
  }

  tick() {
    for (const task of this.store.state.tasks) {
      if (
        task.enabled &&
        task.nextRun &&
        task.nextRun <= Date.now() &&
        !this.running.has(task.id) &&
        !digestOwner(this.store.state.tasks, task.id)
      ) {
        task.nextRun = nextRun(task.schedule)
        this.store.save()
        void this.run(task.id)
      }
    }
  }

  stop() {
    clearInterval(this.timer)
    for (const controller of this.running.values()) {
      controller.abort()
    }
  }

  async execute(
    plugin: InstalledPlugin,
    task: Task,
    controller: AbortController,
    trace: (event: Trace) => void = () => {},
  ): Promise<PluginResult> {
    return new Promise<PluginResult>((resolve, reject) => {
      const child = this.utilityProcess.fork(path.join(__dirname, 'plugin-worker.cjs'), [], {
        stdio: 'ignore',
        env: { PATH: process.env.PATH, LANG: 'zh_CN.UTF-8' },
      })
      let finished = false
      let aiCalls = 0
      let toolRounds = 0
      let sourceCalls = 0
      let postCalls = 0
      const timeoutMs = plugin.capabilities?.includes('ai.tools') ? 300000 : 120000
      const timeout = setTimeout(
        () => finish(new Error(`任务超过 ${timeoutMs / 1000} 秒，已停止`)),
        timeoutMs,
      )
      const abort = () => finish(new Error('任务已取消'))
      const finish = (error: Error | null, output?: PluginResult) => {
        if (finished) {
          return
        }
        finished = true
        clearTimeout(timeout)
        controller.signal.removeEventListener('abort', abort)
        child.kill()
        controller.abort()
        if (error) {
          reject(error)
        } else {
          resolve(output!)
        }
      }
      controller.signal.addEventListener('abort', abort, { once: true })
      child.on('exit', () => finish(new Error('插件进程意外退出')))
      child.on('message', async (message: WorkerMessage) => {
        if (message.type === 'trace') {
          trace(message.event)
        } else if (message.type === 'done') {
          finish(null, message.output)
        } else if (message.type === 'error') {
          finish(new Error(message.error))
        } else if (message.type === 'bilibili' || message.type === 'tieba') {
          try {
            const isPost = message.type === 'tieba' && message.action === 'post'
            if (
              !plugin.capabilities?.includes((message.type + '.read') as Capability) ||
              (isPost
                ? ++postCalls > (plugin.capabilities?.includes('ai.tools') ? 80 : 5)
                : ++sourceCalls > (message.type === 'tieba' ? 20 : 2))
            ) {
              throw new Error('插件未声明平台读取能力，或超过单次读取次数')
            }
            const value =
              message.type === 'bilibili'
                ? await this.services.bilibili.feed(message.input, controller.signal)
                : message.action === 'post'
                  ? await this.services.tieba.post(message.input, controller.signal)
                  : message.action === 'search'
                    ? await this.services.tieba.search(message.input, controller.signal)
                    : await this.services.tieba.feed(message.input, controller.signal)
            if (!finished) {
              child.postMessage({ type: 'reply', id: message.id, value })
            }
          } catch (error) {
            if (!finished) {
              child.postMessage({
                type: 'reply',
                id: message.id,
                error: this.store.redact(errorMessage(error)),
              })
            }
          }
        } else if (message.type === 'x') {
          try {
            if (
              !plugin.capabilities?.includes('x.read') ||
              (message.action !== 'detail' ? ++sourceCalls > 8 : ++postCalls > 3)
            ) {
              throw new Error('插件未声明 X 读取能力，或已超过 8 次采集 / 3 次详情上限')
            }
            const value =
              message.action === 'search'
                ? await this.services.x.search(message.input, controller.signal)
                : message.action === 'following'
                  ? await this.services.x.following(message.input, controller.signal)
                  : await this.services.x.detail(message.input, controller.signal)
            if (!finished) {
              child.postMessage({ type: 'reply', id: message.id, value })
            }
          } catch (error) {
            if (!finished) {
              child.postMessage({
                type: 'reply',
                id: message.id,
                error: this.store.redact(errorMessage(error)),
              })
            }
          }
        } else if (message.type === 'xiaohongshu') {
          try {
            if (
              !plugin.capabilities?.includes('xiaohongshu.read') ||
              (message.action === 'detail' ? ++postCalls > 6 : ++sourceCalls > 4)
            ) {
              throw new Error('小红书读取能力未声明或超过 4 次采集 / 6 篇详情上限')
            }
            const value =
              message.action === 'feed'
                ? await this.services.xiaohongshu.feed(message.input, controller.signal)
                : message.action === 'search'
                  ? await this.services.xiaohongshu.search(message.input, controller.signal)
                  : await this.services.xiaohongshu.detail(message.input, controller.signal)
            if (!finished) child.postMessage({ type: 'reply', id: message.id, value })
          } catch (error) {
            if (!finished)
              child.postMessage({
                type: 'reply',
                id: message.id,
                error: this.store.redact(errorMessage(error)),
              })
          }
        } else if (message.type === 'ai-tools') {
          try {
            if (!plugin.capabilities?.includes('ai.tools') || ++toolRounds > 35) {
              throw new Error('插件未声明 AI 工具能力，或已超过 35 轮调用上限')
            }
            const value = await this.services.respond(
              task.providerId,
              message.input,
              controller.signal,
            )
            if (!finished) {
              child.postMessage({ type: 'reply', id: message.id, value })
            }
          } catch (error) {
            if (!finished) {
              child.postMessage({
                type: 'reply',
                id: message.id,
                error: this.store.redact(errorMessage(error)),
              })
            }
          }
        } else if (message.type === 'ai') {
          try {
            if (++aiCalls > 5) {
              throw new Error('每次任务最多调用 AI 5 次')
            }
            const value = await this.services.generate(
              task.providerId,
              message.prompt,
              controller.signal,
            )
            if (!finished) {
              child.postMessage({ type: 'reply', id: message.id, value })
            }
          } catch (error) {
            if (!finished) {
              child.postMessage({
                type: 'reply',
                id: message.id,
                error: this.store.redact(errorMessage(error)),
              })
            }
          }
        }
      })
      child.postMessage({
        type: 'run',
        task: { id: task.id, name: task.name },
        entry: path.join(plugin.location, plugin.entry),
        config: task.config,
        state: task.pluginState || {},
        now: new Date().toISOString(),
      })
    })
  }

  async collectDigest(task: Task, controller: AbortController, trace: (event: Trace) => void) {
    if (
      !this.store.state.channels.some(
        (channel) => channel.id === task.channelId && channel.kind === 'dingdong',
      )
    ) {
      throw new Error('统一 HTML 推送需要选择叮咚渠道')
    }
    const sources = digestSources(this.store.state.tasks, { ...task, enabled: true })
    if (sources.some((source) => this.running.has(source.id))) {
      throw new Error('选入的内容源正在执行，请稍后重试')
    }
    const commits: Array<{ task: Task; output: PluginResult; digest?: string }> = []
    const sections: NonNullable<import('./types.cjs').Message['sections']> = []
    const failures: NonNullable<RunRecord['sourceFailures']> = []
    for (const source of sources) {
      this.running.set(source.id, controller)
    }
    for (const source of sources) {
      controller.signal.throwIfAborted()
      const plugin = this.plugins.list().find((entry) => entry.id === source.pluginId)
      trace({ tool: 'collect_source', forum: source.name, detail: '开始采集', status: 'ok' })
      const childController = new AbortController()
      const cancel = () => childController.abort()
      controller.signal.addEventListener('abort', cancel, { once: true })
      try {
        if (!plugin) throw new Error(`「${source.name}」的插件不存在`)
        const output = await this.execute(
          plugin,
          structuredClone(source),
          childController,
          (event) =>
            trace({ ...event, forum: source.name + (event.forum ? ' · ' + event.forum : '') }),
        )
        controller.signal.throwIfAborted()
        validateOutput(output)
        const digest = output.message ? messageDigest(output.message) : undefined
        if (output.message && !(source.onlyChanged && digest === source.lastDigest)) {
          sections.push({ name: source.name, message: output.message })
        }
        commits.push({ task: source, output, digest })
        trace({
          tool: 'collect_source',
          forum: source.name,
          detail: output.message ? '内容已收集，等待合并投递' : '本轮没有新内容',
          status: 'ok',
        })
      } catch (error) {
        // Explicit cancellation stops the whole run; source errors only stop that source.
        controller.signal.throwIfAborted()
        const detail = this.store.redact(errorMessage(error)).slice(0, 600)
        failures.push({ taskId: source.id, name: this.store.redact(source.name), detail })
        trace({ tool: 'collect_source', forum: source.name, status: 'error', detail })
      } finally {
        controller.signal.removeEventListener('abort', cancel)
        childController.abort()
      }
    }
    return {
      output: {
        message: combineMessages(task.name, sections),
        detail: failures.length ? '成功来源本轮没有新内容，未发送通知' : '所有内容源均无新内容',
      } as PluginResult,
      failures,
      successfulSources: commits.length,
      commit: () => {
        for (const entry of commits) {
          entry.task.pluginState = entry.output.state ?? entry.task.pluginState ?? {}
          if (entry.digest) {
            entry.task.lastDigest = entry.digest
          }
        }
      },
    }
  }

  async run(taskId: string) {
    if (this.running.has(taskId)) {
      throw new Error('这个任务正在执行')
    }
    const task = this.store.state.tasks.find((entry) => entry.id === taskId)
    if (!task) {
      throw new Error('任务不存在')
    }
    const owner = digestOwner(this.store.state.tasks, taskId)
    if (owner) {
      throw new Error(`此内容源由「${owner.name}」统一推送，请运行汇总任务`)
    }
    const plugin = this.plugins.list().find((entry) => entry.id === task.pluginId)
    const controller = new AbortController()
    this.running.set(taskId, controller)
    const record: RunRecord = {
      id: crypto.randomUUID(),
      taskId,
      name: task.name,
      startedAt: Date.now(),
      status: 'running',
      detail: '',
    }
    this.store.state.history.unshift(record)
    this.store.state.history = this.store.state.history.slice(0, 300)
    this.store.save()
    this.changed()
    let commitSources = () => {}
    try {
      if (!plugin) {
        throw new Error('插件不存在，请重新导入')
      }
      const trace = (event: Trace) => {
        if (!event || typeof event.tool !== 'string' || typeof event.detail !== 'string') {
          return
        }
        record.trace ||= []
        if (record.trace.length >= 100) {
          return
        }
        record.trace.push({
          at: Date.now(),
          forum: this.store.redact(String(event.forum || '').slice(0, 60)),
          tool: event.tool.slice(0, 60),
          status: event.status === 'error' ? 'error' : 'ok',
          detail: this.store.redact(event.detail.slice(0, 600)),
        })
        this.store.save()
        this.changed()
      }
      let output: PluginResult
      if (task.pluginId === DIGEST_ID) {
        const collected = await this.collectDigest(task, controller, trace)
        output = collected.output
        commitSources = collected.commit
        if (collected.failures.length) record.sourceFailures = collected.failures
        if (!collected.successfulSources)
          throw new Error('所有内容源采集失败，未发送通知；请查看来源错误')
      } else {
        output = await this.execute(plugin, structuredClone(task), controller, trace)
      }
      validateOutput(output, task.pluginId === DIGEST_ID)
      if (output.message === null) {
        record.status = 'skipped'
        record.detail =
          typeof output.detail === 'string'
            ? this.store.redact(output.detail.slice(0, 200))
            : '插件没有新内容'
      } else {
        const message = output.message
        const digest = messageDigest(message)
        record.message = {
          title: this.store.redact(message.title),
          body: this.store.redact(message.body),
          short: this.store.redact(message.short || ''),
          format: message.format,
          articles: message.articles,
          sections: message.sections,
        }
        if (task.onlyChanged && digest === task.lastDigest) {
          record.status = 'skipped'
          record.detail = '内容与上次成功推送相同'
        } else {
          // Use a fresh controller because the plugin process has already finished.
          const delivery = new AbortController()
          for (const [id, current] of this.running) {
            if (current === controller) {
              this.running.set(id, delivery)
            }
          }
          const isDingdong = this.store.state.channels?.some(
            (entry) => entry.id === task.channelId && entry.kind === 'dingdong',
          )
          if (isDingdong) {
            record.delivery = { channelId: task.channelId, messageId: record.id, status: 'unknown' }
            this.store.save()
          }
          const detail = await this.services.send(task.channelId, message, delivery.signal, {
            id: record.id,
            onStatus: (status) => {
              if (record.delivery) {
                record.delivery.status = status
                this.store.save()
              }
            },
          })
          task.lastDigest = digest
          record.status = 'sent'
          record.detail = detail || '推送服务已接受消息'
        }
      }
      task.pluginState = output.state ?? task.pluginState ?? {}
      commitSources()
      if (record.sourceFailures?.length) {
        record.status = 'partial'
        record.detail += `；${record.sourceFailures.length} 个来源失败（${record.sourceFailures.map((source) => source.name).join('、')}），失败来源进度已保留`
      }
    } catch (error) {
      record.status = 'failed'
      record.detail = this.store.redact(errorMessage(error))
    } finally {
      record.finishedAt = Date.now()
      const current = this.running.get(taskId)
      for (const [id, active] of this.running) {
        if (active === current) {
          this.running.delete(id)
        }
      }
      this.store.save()
      this.changed()
    }
    return record
  }
}

export { Engine }
