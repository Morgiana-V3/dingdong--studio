import crypto from 'node:crypto'
import { relayAddress } from './channels.cjs'
import { errorMessage, type Snapshot, type TaskInput, type Fetcher } from './types.cjs'

const supported = new Set([
  'bilibili-videos',
  'tieba-subscription',
  'x-interests',
  'xiaohongshu-interests',
  'minipush-digest',
])

// Deliberately project only editable subscription data: no credentials, paths,
// history/message bodies, platform sessions, or plugin execution state.
export function mobileSnapshot(state: Snapshot) {
  const tasks = state.tasks
    .filter((task) => supported.has(task.pluginId))
    .map((task) => ({
      id: task.id,
      name: task.name,
      pluginId: task.pluginId,
      channelId: task.channelId,
      providerId: task.providerId,
      schedule: task.schedule,
      enabled: task.enabled,
      onlyChanged: task.onlyChanged,
      config: task.config,
    }))
  const settings = {
    tasks,
    plugins: state.plugins
      .filter((plugin) => supported.has(plugin.id))
      .map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        fields: plugin.fields,
      })),
    channels: state.channels.map(({ id, name, kind }) => ({ id, name, kind })),
    providers: state.providers.map(({ id, name }) => ({ id, name })),
  }
  return {
    ...settings,
    revision: crypto.createHash('sha256').update(JSON.stringify(settings)).digest('hex'),
    running: state.running.filter((id) => tasks.some((task) => task.id === id)),
  }
}

export interface MobileCommand {
  id: string
  session: string
  revision: string
  action: string
  payload: Record<string, unknown>
  ttlMs: number
}
interface Actions {
  snapshot(): Snapshot
  saveTask(input: TaskInput): void
  deleteTask(id: string): void
}

export function applyMobileCommand(actions: Actions, command: MobileCommand) {
  const snapshot = mobileSnapshot(actions.snapshot())
  if (snapshot.revision !== command.revision) {
    throw new Error('订阅设置已在其他位置修改，请刷新后重试')
  }
  const input = command.payload
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('无效设置')
  const task = snapshot.tasks.find((entry) => entry.id === input.id)
  if (command.action === 'saveTask') {
    if (input.id !== undefined && !task) throw new Error('订阅不存在，请刷新')
    if (typeof input.pluginId !== 'string' || !supported.has(input.pluginId)) {
      throw new Error('手机仅支持内置订阅插件，请在电脑端管理其他插件')
    }
    if (
      typeof input.enabled !== 'boolean' ||
      typeof input.onlyChanged !== 'boolean' ||
      !input.config ||
      typeof input.config !== 'object' ||
      Array.isArray(input.config)
    ) {
      throw new Error('订阅设置格式不正确')
    }
    // The shared desktop handler validates schedules, AI, sources, and running tasks.
    actions.saveTask(input as unknown as TaskInput)
  } else if (command.action === 'setEnabled') {
    if (!task || typeof input.enabled !== 'boolean') throw new Error('订阅或启用状态无效')
    actions.saveTask({ ...task, enabled: input.enabled })
  } else if (command.action === 'deleteTask') {
    if (!task) throw new Error('订阅不存在，请刷新')
    actions.deleteTask(task.id)
  } else {
    throw new Error('手机不支持此操作')
  }
}

export interface MobileConnection {
  id: string
  baseUrl: string
  key: string
}
export class MobileControl {
  private session = crypto.randomUUID()
  private stopped = true
  private timer?: ReturnType<typeof setTimeout>
  private controller?: AbortController
  private results: Array<{ id: string; ok: boolean; error?: string }> = []
  private connectionId = ''
  status = '手机管理未开启'

  constructor(
    private connection: () => MobileConnection | undefined,
    private actions: Actions,
    private fetcher: Fetcher,
    private changed: () => void,
    private redact: (message: string) => string,
  ) {}

  start() {
    if (!this.stopped) return
    this.stopped = false
    void this.tick()
  }
  stop() {
    this.stopped = true
    clearTimeout(this.timer)
    this.controller?.abort()
  }
  private setStatus(status: string) {
    if (this.status !== status) {
      this.status = status
      this.changed()
    }
  }
  private async tick() {
    try {
      const connection = this.connection()
      if (!connection) {
        this.connectionId = ''
        this.results = []
        this.setStatus('手机管理未开启')
        return
      }
      const identity = JSON.stringify(connection)
      if (identity !== this.connectionId) {
        this.session = crypto.randomUUID()
        this.results = []
        this.connectionId = identity
      }
      const sentResults = this.results.length
      this.controller = new AbortController()
      const started = Date.now()
      const response = await this.fetcher(relayAddress(connection.baseUrl) + '/v1/studio/sync', {
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: `Bearer ${connection.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: this.session,
          snapshot: mobileSnapshot(this.actions.snapshot()),
          results: this.results,
        }),
        signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(10000)]),
      })
      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? '请先升级叮咚服务器以支持手机管理'
            : response.status === 409
              ? '已有另一台 Studio 连接此服务器'
              : `手机管理连接失败（HTTP ${response.status}）`,
        )
      }
      const result = (await response.json()) as { commands: MobileCommand[] }
      if (!Array.isArray(result.commands)) throw new Error('服务器控制协议不兼容')
      if (this.stopped || JSON.stringify(this.connection()) !== identity) return
      this.results.splice(0, sentResults)
      this.setStatus('手机管理已连接')
      for (const command of result.commands) {
        if (command.session !== this.session || Date.now() - started >= command.ttlMs) continue
        try {
          applyMobileCommand(this.actions, command)
          this.results.push({ id: command.id, ok: true })
          this.changed()
        } catch (error) {
          this.results.push({ id: command.id, ok: false, error: this.redact(errorMessage(error)) })
        }
      }
    } catch (error) {
      if (!this.stopped) this.setStatus(this.redact(errorMessage(error)))
    } finally {
      if (!this.stopped) this.timer = setTimeout(() => void this.tick(), 2000)
    }
  }
}
