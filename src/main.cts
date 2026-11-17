import { Xiaohongshu } from './xiaohongshu.cjs'
import { MobileControl } from './mobile-control.cjs'
import * as xhsPlugin from '../examples/xiaohongshu/index.cjs'
import { DIGEST_ID, digestSources, digestOwner, sourceIds } from './digest.cjs'
import { dingdongDocument, compatibleLink } from './dingdong-document.cjs'
import { loadDingdongImage } from './dingdong-images.cjs'
import * as xPlugin from '../examples/x/index.cjs'
import type { Handlers } from './ipc.cjs'
import type { Trace, RunRecord } from './types.cjs'
import * as tiebaPlugin from '../examples/tieba/index.cjs'
import { errorMessage } from './types.cjs'
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  nativeImage,
  utilityProcess,
  net,
  Menu,
  shell,
  powerMonitor,
  session,
} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Store } from './store.cjs'
import { Plugins } from './plugins.cjs'
import { Services } from './services.cjs'
import { Engine } from './engine.cjs'
import { Bilibili } from './bilibili.cjs'
import { Tieba } from './tieba.cjs'
import { XHTTP } from './x-http.cjs'
import { XCredentials } from './x-credentials.cjs'
import { XChrome } from './x-chrome.cjs'
import { XSourceService } from './x.cjs'
import { requiredText, nextRun, validateSchedule, validateConfig } from './domain.cjs'

const runtimeRoot = path.resolve(__dirname, '..')

// Keep the existing Electron identity for the user data and saved credentials.
app.setName('MiniPush')
if (process.env.MINIPUSH_TEST_DATA) {
  app.setPath('userData', process.env.MINIPUSH_TEST_DATA)
}
const hasLock = app.requestSingleInstanceLock()
if (!hasLock) {
  app.quit()
}
let window: BrowserWindow
let store: Store
let plugins: Plugins
let engine: Engine
let mobileControl: MobileControl | undefined
let quitting = false

function openWindow() {
  if (window && !window.isDestroyed()) {
    window.show()
    window.focus()
    return
  }
  window = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    title: 'DingDong Studio',
    backgroundColor: '#faf7f0',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.loadFile(path.join(__dirname, 'ui/index.html'))
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      window.hide()
    }
  })
}

function changed() {
  if (window && !window.isDestroyed()) {
    window.webContents.send('changed')
  }
}

app
  .whenReady()
  .then(() => {
    if (!hasLock) {
      return
    }
    store = new Store(app.getPath('userData'), safeStorage)
    plugins = new Plugins(path.join(app.getPath('userData'), 'plugins'))
    const services = new Services(
      store,
      (url, options) => net.fetch(url, options),
      loadDingdongImage,
    )
    const bilibili = new Bilibili(session.fromPartition('persist:minipush-bilibili'), BrowserWindow)
    services.bilibili = bilibili
    const tieba = new Tieba(session.fromPartition('minipush-tieba-public'))
    services.tieba = tieba
    const x = new XSourceService(
      session.fromPartition('persist:minipush-x'),
      BrowserWindow,
      new XChrome(app.getPath('userData')),
      new XHTTP(app.getPath('userData'), utilityProcess, (url) =>
        session.defaultSession.resolveProxy(url),
      ),
      new XCredentials(app.getPath('userData'), store),
    )
    services.x = x
    const xhs = new Xiaohongshu(
      session.fromPartition('persist:minipush-xiaohongshu'),
      BrowserWindow,
    )
    services.xiaohongshu = xhs
    engine = new Engine(store, plugins, services, utilityProcess, changed)

    // One-time local provisioning. Secrets are immediately encrypted and the seed is deleted.
    const seedPath = process.env.MINIPUSH_SEED
    if (seedPath && fs.existsSync(seedPath)) {
      const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'))
      if (!store.state.channels.length && seed.sendKey) {
        store.state.channels.push({
          id: crypto.randomUUID(),
          name: '小米手机',
          kind: 'sc3',
          secret: store.encrypt(seed.sendKey),
        })
      }
      if (!store.state.providers.length && seed.apiKey) {
        store.state.providers.push({
          id: crypto.randomUUID(),
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4.1-mini',
          maxOutputTokens: 1500,
          secret: store.encrypt(seed.apiKey),
        })
      }
      store.save()
      fs.unlinkSync(seedPath)
    }

    const handlers: Handlers = {
      snapshot() {
        return {
          ...store.snapshot(),
          plugins: plugins.list(),
          running: [...engine.running.keys()],
          mobileControlStatus: mobileControl?.status,
        }
      },
      async importPlugin() {
        const selected = await dialog.showOpenDialog(window, {
          title: '选择含 plugin.json 的插件文件夹',
          properties: ['openDirectory'],
        })
        if (selected.canceled) {
          return null
        }
        const approved = await dialog.showMessageBox(window, {
          type: 'question',
          message: '导入本地插件',
          detail: '插件脚本可访问本机文件和网络。请确认这份代码来自你信任的来源。',
          buttons: ['取消', '导入'],
          defaultId: 0,
        })
        if (approved.response !== 1) {
          return null
        }
        return plugins.import(selected.filePaths[0])
      },
      addExample() {
        return plugins.import(path.join(runtimeRoot, 'examples/hello'))
      },
      installBilibili() {
        const existing = plugins.list().find((plugin) => plugin.id === 'bilibili-videos')
        return existing || plugins.import(path.join(runtimeRoot, 'examples/bilibili'))
      },
      bilibiliLogin() {
        return bilibili.login()
      },
      bilibiliAccount() {
        return bilibili.account()
      },
      bilibiliLogout() {
        return bilibili.logout()
      },
      bilibiliFollowings(input) {
        return bilibili.followings(input)
      },
      bilibiliPreview(input) {
        return bilibili.feed({ accountMid: input.accountMid, since: 0, preview: true })
      },
      installXHS() {
        return (
          plugins.list().find((plugin) => plugin.id === 'xiaohongshu-interests') ||
          plugins.import(path.join(runtimeRoot, 'examples/xiaohongshu'))
        )
      },
      xhsLogin() {
        return xhs.login()
      },
      xhsAccount() {
        return xhs.account()
      },
      xhsLogout() {
        return xhs.logout()
      },
      async xhsInterestPreview(input) {
        if (!store.state.providers.some((provider) => provider.id === input.providerId))
          throw new Error('请选择 AI 配置')
        const trace: Trace[] = []
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 300000)
        let rounds = 0,
          lists = 0,
          reads = 0
        try {
          const result = await xhsPlugin.preview({
            config: input.config,
            state: {},
            now: new Date().toISOString(),
            log(event) {
              trace.push({ ...event, detail: store.redact(event.detail.slice(0, 600)) })
            },
            sources: {
              xiaohongshu: {
                feed(value) {
                  if (++lists > 4) throw new Error('采集次数超限')
                  return xhs.feed(value, controller.signal)
                },
                search(value) {
                  if (++lists > 4) throw new Error('采集次数超限')
                  return xhs.search(value, controller.signal)
                },
                detail(value) {
                  if (++reads > 6) throw new Error('详情次数超限')
                  return xhs.detail(value, controller.signal)
                },
              },
            },
            ai: {
              respond(request) {
                if (++rounds > 9) throw new Error('AI 调用次数超限')
                return services.respond(input.providerId, request, controller.signal)
              },
            },
          })
          return { ...result, trace }
        } catch (error) {
          return { error: store.redact(errorMessage(error)), trace }
        } finally {
          clearTimeout(timer)
          controller.abort()
        }
      },
      installX() {
        return (
          plugins.list().find((plugin) => plugin.id === 'x-interests') ||
          plugins.import(path.join(runtimeRoot, 'examples/x'))
        )
      },
      xSearchPreview(input) {
        return x.search(input)
      },
      async xInterestPreview(input) {
        if (!store.state.providers.some((provider) => provider.id === input.providerId)) {
          throw new Error('请先选择 AI 配置')
        }
        const trace: Trace[] = []
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 300000)
        let rounds = 0
        let searches = 0
        let reads = 0
        try {
          const result = await xPlugin.preview({
            config: input.config,
            state: {},
            now: new Date().toISOString(),
            log(event) {
              trace.push({ ...event, detail: store.redact(event.detail.slice(0, 600)) })
            },
            sources: {
              x: {
                following(value) {
                  if (++searches > 8) throw new Error('每轮最多采集 8 次')
                  return x.following(value, controller.signal)
                },
                search(value) {
                  if (++searches > 8) {
                    throw new Error('每轮最多采集 8 次')
                  }
                  return x.search(value, controller.signal)
                },
                detail(value) {
                  if (++reads > 3) {
                    throw new Error('每轮最多读取 3 篇详情')
                  }
                  return x.detail(value, controller.signal)
                },
              },
            },
            ai: {
              respond(request) {
                if (++rounds > 9) {
                  throw new Error('每轮最多调用 AI 9 次')
                }
                return services.respond(input.providerId, request, controller.signal)
              },
            },
          })
          return { ...result, trace }
        } catch (error) {
          return { error: store.redact(errorMessage(error)), trace }
        } finally {
          clearTimeout(timer)
          controller.abort()
        }
      },
      xImportChromeSession() {
        return x.importChromeSession()
      },
      xLoginChrome() {
        return x.loginChrome()
      },
      xLogin() {
        return x.login()
      },
      xRefreshSession() {
        return x.refreshSession()
      },
      xAccount() {
        return x.account()
      },
      xLogout() {
        return x.logout()
      },
      installTieba() {
        const existing = plugins.list().find((plugin) => plugin.id === 'tieba-subscription')
        return existing || plugins.import(path.join(runtimeRoot, 'examples/tieba'))
      },
      tiebaPreview(input) {
        return tieba.feed({ target: input.target, mode: 'interests' })
      },
      async tiebaInterestPreview(input) {
        if (!store.state.providers.some((provider) => provider.id === input.providerId)) {
          throw new Error('请先选择 AI 配置')
        }
        const plugin = tiebaPlugin
        const trace: Trace[] = []
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 300000)
        let rounds = 0
        try {
          const result = await plugin.preview({
            config: input.config,
            state: {},
            now: new Date().toISOString(),
            log(event) {
              if (trace.length < 100) {
                trace.push({
                  ...event,
                  detail: store.redact(String(event.detail || '').slice(0, 600)),
                })
              }
            },
            sources: {
              tieba: {
                search: (value) => tieba.search(value, controller.signal),
                feed: (value) => tieba.feed(value, controller.signal),
                post: (value) => tieba.post(value, controller.signal),
              },
            },
            ai: {
              respond(request) {
                if (++rounds > 35) {
                  throw new Error('AI 工具调用超过 35 轮')
                }
                return services.respond(input.providerId, request, controller.signal)
              },
            },
          })
          return { ...result, trace }
        } catch (error) {
          return { error: store.redact(errorMessage(error)), trace }
        } finally {
          clearTimeout(timer)
          controller.abort()
        }
      },
      deletePlugin(id) {
        if (id === DIGEST_ID) {
          throw new Error('统一推送为内置插件，无需移除')
        }
        if (store.state.tasks.some((task) => task.pluginId === id)) {
          throw new Error('请先删除使用此插件的任务')
        }
        const plugin = plugins.list().find((entry) => entry.id === id)
        if (!plugin) {
          throw new Error('插件不存在')
        }
        fs.rmSync(plugin.location, { recursive: true })
      },
      saveChannel(input) {
        const existing = store.state.channels.find((entry) => entry.id === input.id)
        const { key, ...connection } = services.channelConnection(input)
        const channel = {
          id: existing?.id || crypto.randomUUID(),
          name: requiredText(input.name, '渠道名称'),
          kind: input.kind,
          ...connection,
          secret: store.encrypt(key),
        }
        store.state.channels = store.state.channels.filter((entry) => entry.id !== channel.id)
        store.state.channels.push(channel)
        store.save()
      },
      async previewDelivery(id) {
        const record = store.state.history.find((entry) => entry.id === id)
        if (!record?.message) {
          throw new Error('这条记录没有消息正文')
        }
        const document = await dingdongDocument(record.message, loadDingdongImage)
        const preview = new BrowserWindow({
          width: 480,
          height: 860,
          minWidth: 340,
          title: '推送正文预览 · ' + record.name,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            javascript: false,
          },
        })
        preview.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        preview.webContents.on('will-navigate', (event, address) => {
          event.preventDefault()
          try {
            const compatible = compatibleLink(address)
            if (!compatible) {
              return
            }
            const url = new URL(compatible)
            if (url.protocol === 'com.baidu.tieba:') {
              void shell.openExternal('https://tieba.baidu.com/p/' + url.searchParams.get('tid'))
            } else if (['https:', 'http:'].includes(url.protocol)) {
              void shell.openExternal(url.href)
            }
          } catch {
            /* Invalid links are ignored. */
          }
        })
        await preview.loadURL(
          'data:text/html;charset=utf-8;base64,' + Buffer.from(document.content).toString('base64'),
        )
      },
      async checkDelivery(id) {
        const record = store.state.history.find((entry) => entry.id === id)
        if (!record?.delivery) {
          throw new Error('这条记录没有叮咚投递信息')
        }
        const status = await services.deliveryStatus(
          record.delivery.channelId,
          record.delivery.messageId,
        )
        record.delivery.status = status
        store.save()
        return status === 'received'
          ? '手机已保存正文（不代表已读）'
          : '服务器已接收，等待手机上线保存'
      },
      deleteChannel(id) {
        if (store.state.tasks.some((task) => task.channelId === id)) {
          throw new Error('这个渠道仍被任务使用')
        }
        store.state.channels = store.state.channels.filter((entry) => entry.id !== id)
        store.save()
      },
      async testChannel(id) {
        const channel = store.state.channels.find((entry) => entry.id === id)
        const message = {
          title: 'DingDong Studio 渠道测试',
          body: '## 连接测试\n\n这条消息由 Mac mini 上的 DingDong Studio 发出。',
        }
        if (channel?.kind !== 'dingdong') {
          return services.send(id, message)
        }
        const picture = nativeImage
          .createFromPath(path.join(__dirname, 'ui/assets/icons/channels.png'))
          .resize({ width: 96 })
          .toPNG()
          .toString('base64')
        message.body +=
          '\n\n![推送信箱](data:image/png;base64,' +
          picture +
          ')\n\n正文与图片会保存在手机，可离线阅读。'
        const record: RunRecord = {
          id: crypto.randomUUID(),
          taskId: '',
          name: '叮咚渠道测试',
          startedAt: Date.now(),
          status: 'running',
          detail: '',
          message,
        }
        record.delivery = { channelId: id, messageId: record.id, status: 'unknown' }
        store.state.history.unshift(record)
        store.state.history = store.state.history.slice(0, 300)
        store.save()
        try {
          record.detail = await services.send(id, message, undefined, {
            id: record.id,
            onStatus: (status) => {
              record.delivery!.status = status
              store.save()
            },
          })
          record.status = 'sent'
          return record.detail
        } catch (error) {
          record.status = 'failed'
          record.detail = store.redact(errorMessage(error))
          throw error
        } finally {
          record.finishedAt = Date.now()
          store.save()
        }
      },
      saveProvider(input) {
        const existing = store.state.providers.find((entry) => entry.id === input.id)
        const { baseUrl, key } = services.providerConnection(input)
        const limit = Number(input.maxOutputTokens)
        if (!Number.isInteger(limit) || limit < 64 || limit > 16000) {
          throw new Error('输出上限需在 64–16000 之间')
        }
        const provider = {
          id: existing?.id || crypto.randomUUID(),
          name: requiredText(input.name, 'AI 配置名称'),
          model: requiredText(input.model, '模型'),
          baseUrl,
          maxOutputTokens: limit,
          secret: store.encrypt(key!),
        }
        store.state.providers = store.state.providers.filter((entry) => entry.id !== provider.id)
        store.state.providers.push(provider)
        store.save()
      },
      listModels(input) {
        return services.listModels(input)
      },
      deleteProvider(id) {
        if (store.state.tasks.some((task) => task.providerId === id)) {
          throw new Error('这个 AI 配置仍被任务使用')
        }
        store.state.providers = store.state.providers.filter((entry) => entry.id !== id)
        store.save()
      },
      async testProvider(id) {
        const text = await services.generate(id, '请只回复：AI 连接成功')
        return text.slice(0, 300)
      },
      saveTask(input) {
        const existing = store.state.tasks.find((entry) => entry.id === input.id)
        if (existing && engine.running.has(existing.id)) {
          throw new Error('任务正在执行，请完成后再编辑')
        }
        const plugin = plugins.list().find((entry) => entry.id === input.pluginId)
        if (!plugin) {
          throw new Error('请选择插件')
        }
        if (!store.state.channels.some((entry) => entry.id === input.channelId)) {
          throw new Error('请选择推送渠道')
        }
        if (
          input.providerId &&
          !store.state.providers.some((entry) => entry.id === input.providerId)
        ) {
          throw new Error('AI 配置不存在')
        }
        if (
          ['tieba-subscription', 'x-interests', 'xiaohongshu-interests'].includes(plugin.id) &&
          !input.providerId
        ) {
          throw new Error('兴趣筛选需要选择一个 AI 配置')
        }
        if (plugin.id === 'xiaohongshu-interests') xhsPlugin.configValues(input.config)
        if (plugin.id === 'x-interests') {
          xPlugin.configValues(input.config)
        }
        if (plugin.id === 'tieba-subscription') {
          tiebaPlugin.configValues(input.config)
        }
        const schedule = validateSchedule(input.schedule)
        const followingRun = nextRun(schedule)
        const task = {
          ...existing,
          id: existing?.id || crypto.randomUUID(),
          name: requiredText(input.name, '任务名称'),
          pluginId: plugin.id,
          channelId: input.channelId,
          providerId: input.providerId || '',
          schedule,
          enabled: Boolean(input.enabled),
          onlyChanged: Boolean(input.onlyChanged),
          config: validateConfig(plugin, input.config),
          nextRun: input.enabled ? followingRun : null,
        }
        if (existing && existing.pluginId !== task.pluginId) {
          task.pluginState = {}
          task.lastDigest = null
        }
        const owner = digestOwner(store.state.tasks, task.id)
        if (owner && task.enabled) {
          throw new Error(`此内容源由「${owner.name}」统一推送，请先从汇总中移除`)
        }
        if (task.pluginId === DIGEST_ID) {
          if (
            !store.state.channels.some(
              (channel) => channel.id === task.channelId && channel.kind === 'dingdong',
            )
          ) {
            throw new Error('统一 HTML 推送需要选择叮咚渠道')
          }
          const sources = digestSources(store.state.tasks, task)
          if (sources.some((source) => engine.running.has(source.id))) {
            throw new Error('内容源正在执行，请稍后再保存汇总设置')
          }
          if (task.enabled) {
            for (const source of sources) {
              source.enabled = false
              source.nextRun = null
            }
          }
        }
        store.state.tasks = store.state.tasks.filter((entry) => entry.id !== task.id)
        store.state.tasks.push(task)
        store.save()
      },
      toggleTask(id) {
        const task = store.state.tasks.find((entry) => entry.id === id)
        if (!task) {
          throw new Error('任务不存在')
        }
        if (engine.running.has(id)) {
          throw new Error('任务正在执行，请先完成或取消')
        }
        const owner = digestOwner(store.state.tasks, id)
        if (!task.enabled && owner) {
          throw new Error(`此内容源由「${owner.name}」统一推送，请先从汇总中移除`)
        }
        if (!task.enabled && task.pluginId === DIGEST_ID) {
          const sources = digestSources(store.state.tasks, { ...task, enabled: true })
          if (sources.some((source) => engine.running.has(source.id))) {
            throw new Error('内容源正在执行，请稍后再启用')
          }
          for (const source of sources) {
            source.enabled = false
            source.nextRun = null
          }
        }
        task.enabled = !task.enabled
        task.nextRun = task.enabled ? nextRun(task.schedule) : null
        store.save()
      },
      deleteTask(id) {
        if (
          store.state.tasks.some(
            (task) => task.pluginId === DIGEST_ID && sourceIds(task).includes(id),
          )
        ) {
          throw new Error('请先从汇总任务中移除此内容源，再删除')
        }
        if (engine.running.has(id)) {
          throw new Error('请先取消正在运行的任务')
        }
        store.state.tasks = store.state.tasks.filter((entry) => entry.id !== id)
        store.save()
      },
      runTask(id) {
        return engine.run(id)
      },
      cancelTask(id) {
        engine.running.get(id)?.abort()
      },
      preferences(input) {
        if (input.mobileChannelId !== undefined) {
          if (
            input.mobileChannelId &&
            !store.state.channels.some(
              (channel) => channel.id === input.mobileChannelId && channel.kind === 'dingdong',
            )
          ) {
            throw new Error('请选择叮咚推送渠道')
          }
          store.state.preferences.mobileChannelId = input.mobileChannelId
        }
        if (input.startAtLogin !== undefined) {
          store.state.preferences.startAtLogin = Boolean(input.startAtLogin)
          app.setLoginItemSettings({ openAtLogin: store.state.preferences.startAtLogin })
        }
        store.save()
        changed()
      },
      openExamples() {
        return shell.openPath(path.join(runtimeRoot, 'examples'))
      },
    }

    mobileControl = new MobileControl(
      () => {
        const channel = store.state.channels.find(
          (entry) =>
            entry.id === store.state.preferences.mobileChannelId && entry.kind === 'dingdong',
        )
        return channel
          ? { id: channel.id, baseUrl: channel.baseUrl || '', key: store.decrypt(channel.secret) }
          : undefined
      },
      handlers,
      (url, options) => net.fetch(url, options),
      changed,
      (message) => store.redact(message),
    )
    mobileControl.start()

    ipcMain.handle('invoke', async (event, action: keyof Handlers, payload: unknown) => {
      if (event.sender !== window.webContents || !Object.hasOwn(handlers, action)) {
        return { error: '无效请求' }
      }
      try {
        return { value: await handlers[action](payload as never) }
      } catch (error) {
        return { error: store.redact(errorMessage(error)) }
      }
    })

    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: 'DingDong Studio',
          submenu: [
            { label: '显示窗口', click: openWindow },
            { type: 'separator' },
            { label: '退出 DingDong Studio', accelerator: 'Cmd+Q', click: () => app.quit() },
          ],
        },
        { role: 'editMenu', label: '编辑' },
        { role: 'windowMenu', label: '窗口' },
      ]),
    )
    app.on('activate', openWindow)
    app.on('second-instance', openWindow)
    app.on('before-quit', () => {
      quitting = true
      mobileControl?.stop()
      engine.stop()
      x.stop()
    })
    powerMonitor.on('resume', () => engine.tick())
    openWindow()
    engine.start()
  })
  .catch((error) => {
    dialog.showErrorBox('DingDong Studio 启动失败', errorMessage(error))
    app.quit()
  })
