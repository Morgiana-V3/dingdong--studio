import { openXHS } from './xiaohongshu.js'
import type { Snapshot, Channel, Provider, PluginConfig, TaskDraft } from '../types.cjs'
import { query as getElement, control, checked, values, errorMessage } from './dom.js'
import { toolTraceHTML } from './tool-trace.js'
import { readTimes, timesHTML, bindTimes } from './schedule.js'
import { forumListHTML, bindForumLists, readForumList } from './forum-list.js'
import { icon } from './icons.js'
import { enhanceNumbers } from './controls.js'
import { setupModelPicker } from './models.js'
import { openBilibili } from './bilibili.js'
import { openTieba } from './tieba.js'
import { openX } from './x.js'

const api = window.miniPush
const DIGEST_ID = 'minipush-digest'
let snapshot: Snapshot
let page: keyof typeof titles = 'tasks'
const content = getElement<HTMLElement>(document, '#content')
const toolbar = getElement<HTMLElement>(document, '#toolbar')
const dialog = getElement<HTMLDialogElement>(document, '#editor')
const dialogContent = getElement<HTMLElement>(document, '#dialog-content')
const titles = {
  tasks: '任务',
  plugins: '插件',
  channels: '推送渠道',
  providers: 'AI 配置',
  history: '运行记录',
  settings: '应用设置',
}
const descriptions = {
  tasks: '安排执行时间，让消息按计划送达。',
  plugins: '按需扩展订阅、采集和消息处理能力。',
  channels: '管理手机接收消息的方式。',
  providers: '统一配置，供不同插件调用。',
  history: '查看每次执行的结果与消息内容。',
  settings: '管理应用启动与后台运行。',
}
const statusNames = {
  running: '执行中',
  sent: '已提交推送',
  partial: '部分完成',
  skipped: '已跳过',
  failed: '失败',
  interrupted: '已中断',
}
function escape(value: unknown = '') {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] || character,
  )
}
function date(value?: number | null) {
  if (!value) {
    return '—'
  }
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
function button(label: string, action: string, id = '', style = '') {
  let leadingIcon = ''
  if (style.includes('primary') && !id) {
    leadingIcon = icon('plus')
  } else if (action === 'runTask') {
    leadingIcon = icon('play')
  }
  return `<button class="${style}" data-action="${action}" data-id="${escape(id)}">${leadingIcon}${label}</button>`
}
function notice(message: string, error = false) {
  const element = getElement<HTMLElement>(document, '#notice')
  element.hidden = false
  element.className = error ? 'error' : ''
  element.textContent = message
}
function empty(title: string, action: string, label: string) {
  return `<div class="empty"><span class="empty-icon">${icon(page)}</span><h2>${title}</h2>${button(label, action, '', 'primary')}</div>`
}
function row(title: string, meta: string, actions: string, badge = '') {
  return `<div class="row"><span class="row-icon ${page}">${icon(page)}</span><div class="row-info"><div class="row-title"><strong>${escape(title)}</strong>${badge}</div><div class="meta">${meta}</div></div><div class="actions">${actions}</div></div>`
}
function option(value: string, label: string, selected?: string) {
  return `<option value="${escape(value)}" ${value === selected ? 'selected' : ''}>${escape(label)}</option>`
}
function field(label: string, name: string, value: unknown = '', type = 'text', extra = '') {
  return `<label>${escape(label)}<input name="${name}" type="${type}" value="${escape(value)}" ${extra}></label>`
}
function check(label: string, name: string, checked: unknown) {
  return `<label class="check"><input name="${name}" type="checkbox" ${checked ? 'checked' : ''}>${escape(label)}</label>`
}
async function refresh() {
  snapshot = await api.invoke('snapshot')
  render()
}
function render() {
  getElement<HTMLElement>(document, '#page-title').textContent = titles[page]
  getElement<HTMLElement>(document, '#eyebrow').textContent = descriptions[page]
  content.dataset.page = page
  document.querySelectorAll<HTMLElement>('[data-page]').forEach((element) => {
    element.classList.toggle('selected', element.dataset.page === page)
    element.setAttribute('aria-current', element.dataset.page === page ? 'page' : 'false')
  })
  toolbar.innerHTML = ''
  if (page === 'tasks') {
    toolbar.innerHTML =
      button('新建汇总', 'createDigest') + button('新建任务', 'editTask', '', 'primary')
    content.innerHTML = snapshot.tasks.length
      ? '<div class="list task-list">' +
        snapshot.tasks
          .map((task) => {
            const running = snapshot.running.includes(task.id)
            const owner = snapshot.tasks.find(
              (entry) =>
                entry.pluginId === DIGEST_ID &&
                entry.enabled &&
                String(entry.config.sourceTaskIds || '')
                  .split(',')
                  .includes(task.id),
            )
            const plugin = snapshot.plugins.find((entry) => entry.id === task.pluginId)
            const channel = snapshot.channels.find((entry) => entry.id === task.channelId)
            let schedule = '手动执行'
            if (task.schedule.type === 'daily') {
              schedule = '每天 ' + (task.schedule.times || [task.schedule.time]).join('、')
            } else if (task.schedule.type === 'interval') {
              schedule = '每 ' + task.schedule.minutes + ' 分钟'
            }
            let badge = '<span class="badge">已暂停</span>'
            if (owner) {
              badge = '<span class="badge active">汇总内容源</span>'
            }
            if (running) {
              badge = '<span class="badge active">执行中</span>'
            } else if (task.enabled) {
              badge = '<span class="badge active">已启用</span>'
            }
            const actions = running
              ? button('取消执行', 'cancelTask', task.id, 'small')
              : owner
                ? ''
                : button('立即执行', 'runTask', task.id, 'small')
            const taskActions =
              actions +
              button('编辑', 'editTask', task.id, 'small') +
              (owner
                ? ''
                : button(task.enabled ? '暂停' : '启用', 'toggleTask', task.id, 'small')) +
              button('删除', 'deleteTask', task.id, 'small danger')
            let nextRun = '等待手动执行'
            if (owner) {
              schedule = '随「' + escape(owner.name) + '」执行'
              nextRun = '由汇总任务统一发送'
            } else if (!task.enabled) {
              nextRun = '已暂停调度'
            } else if (task.nextRun) {
              nextRun = '下次执行 ' + date(task.nextRun)
            }
            return `<article class="task-row"><div class="task-heading"><span class="row-icon tasks">${icon('tasks')}</span><h2>${escape(task.name)}</h2>${badge}</div><div class="task-details"><div><span>使用插件</span><strong>${escape(plugin?.name || '插件缺失')}</strong></div><div><span>发送到</span><strong>${escape(channel?.name || '渠道缺失')}</strong></div><div><span>执行计划</span><strong>${schedule}</strong></div></div><div class="task-footer"><span class="next-run">${icon('history')}${nextRun}</span><div class="actions">${taskActions}</div></div></article>`
          })
          .join('') +
        '</div>'
      : empty('暂无任务', 'editTask', '新建任务')
    const enabled = snapshot.tasks.filter((task) => task.enabled).length
    const scheduled = snapshot.tasks.filter(
      (task) => task.enabled && task.schedule.type !== 'manual',
    ).length
    content.innerHTML = `<div class="task-summary"><span><strong>${snapshot.tasks.length}</strong> 个任务</span><span><i class="status-dot"></i>${enabled} 个已启用</span><span>${icon('history')}${scheduled} 个定时执行</span><span class="running-count">${snapshot.running.length} 个执行中</span></div>${content.innerHTML}`
  } else if (page === 'plugins') {
    toolbar.innerHTML =
      button('安装示例', 'addExample') + button('导入插件', 'importPlugin', '', 'primary')
    if (!snapshot.plugins.some((plugin) => plugin.id === 'bilibili-videos')) {
      toolbar.innerHTML = button('安装 B 站插件', 'installBilibili') + toolbar.innerHTML
    }
    content.innerHTML = snapshot.plugins.length
      ? '<div class="list">' +
        snapshot.plugins
          .map((plugin) =>
            row(
              plugin.name,
              `v${escape(plugin.version)} · ${escape(plugin.id)}<br>${escape(plugin.description || '')}`,
              (plugin.id === 'bilibili-videos'
                ? button('登录与订阅', 'manageBilibili', '', 'small')
                : '') +
                (plugin.id === 'tieba-subscription'
                  ? button('配置贴吧订阅', 'manageTieba', '', 'small')
                  : '') +
                (plugin.id === 'xiaohongshu-interests'
                  ? button('登录与兴趣发现', 'manageXHS', '', 'small')
                  : '') +
                (plugin.id === 'x-interests'
                  ? button('登录与兴趣发现', 'manageX', '', 'small')
                  : '') +
                (plugin.id === DIGEST_ID
                  ? button('新建汇总', 'createDigest', '', 'small')
                  : button('移除', 'deletePlugin', plugin.id, 'small danger')),
            ),
          )
          .join('') +
        '</div>'
      : empty('暂无插件', 'importPlugin', '导入插件文件夹')
    if (!snapshot.plugins.some((plugin) => plugin.id === 'tieba-subscription')) {
      content.innerHTML +=
        '<div class="connector-card"><div><strong>贴吧兴趣精选</strong><p class="help">描述你的兴趣，让 AI 挑选值得阅读的帖子。</p></div>' +
        button('安装贴吧插件', 'installTieba') +
        '</div>'
    }
    if (!snapshot.plugins.some((plugin) => plugin.id === 'x-interests')) {
      content.innerHTML +=
        '<div class="connector-card"><div><strong>X 兴趣发现</strong><p class="help">让 AI 按兴趣寻找关键词，搜索并筛选值得阅读的原帖。</p></div>' +
        button('安装 X 插件', 'installX') +
        '</div>'
    }
    if (!snapshot.plugins.some((plugin) => plugin.id === 'xiaohongshu-interests')) {
      content.innerHTML +=
        '<div class="connector-card"><div><strong>小红书兴趣发现</strong><p class="help">推荐流与关键词互补，阅读原文后按兴趣筛选。</p></div>' +
        button('安装小红书插件', 'installXHS') +
        '</div>'
    }
    content.innerHTML +=
      '<p class="section-note">导入包含 plugin.json 与 index.cjs 的文件夹。插件可访问本机文件和网络。</p>' +
      button('打开示例文件夹', 'openExamples', '', 'link')
  } else if (page === 'channels') {
    toolbar.innerHTML = button('添加渠道', 'editChannel', '', 'primary')
    content.innerHTML = snapshot.channels.length
      ? '<div class="list">' +
        snapshot.channels
          .map((channel) =>
            row(
              channel.name,
              `${({ dingdong: '叮咚 App', sc3: 'Server 酱³ App', turbo: 'Server 酱 Turbo' } as Record<string, string>)[channel.kind] || channel.kind} · 密钥已加密保存`,
              button('测试推送', 'testChannel', channel.id, 'small') +
                button('编辑', 'editChannel', channel.id, 'small') +
                button('删除', 'deleteChannel', channel.id, 'small danger'),
            ),
          )
          .join('') +
        '</div>'
      : empty('暂无推送渠道', 'editChannel', '添加渠道')
  } else if (page === 'providers') {
    toolbar.innerHTML = button('添加 AI', 'editProvider', '', 'primary')
    content.innerHTML = snapshot.providers.length
      ? '<div class="list">' +
        snapshot.providers
          .map((provider) =>
            row(
              provider.name,
              `${escape(provider.model)} · 输出上限 ${provider.maxOutputTokens} tokens<br>${escape(provider.baseUrl)}`,
              button('测试 AI', 'testProvider', provider.id, 'small') +
                button('编辑', 'editProvider', provider.id, 'small') +
                button('删除', 'deleteProvider', provider.id, 'small danger'),
            ),
          )
          .join('') +
        '</div>'
      : empty('暂无 AI 配置', 'editProvider', '添加 AI')
    if (!snapshot.plugins.some((plugin) => plugin.id === 'x-interests')) {
      content.innerHTML +=
        '<div class="connector-card"><div><strong>X 兴趣发现</strong><p class="help">让 AI 按兴趣寻找关键词，搜索并筛选值得阅读的原帖。</p></div>' +
        button('安装 X 插件', 'installX') +
        '</div>'
    }
    if (!snapshot.plugins.some((plugin) => plugin.id === 'xiaohongshu-interests')) {
      content.innerHTML +=
        '<div class="connector-card"><div><strong>小红书兴趣发现</strong><p class="help">推荐流与关键词互补，阅读原文后按兴趣筛选。</p></div>' +
        button('安装小红书插件', 'installXHS') +
        '</div>'
    }
    content.innerHTML +=
      '<p class="section-note">插件使用任务选定的 AI。测试会发送一次简短请求并消耗 API 额度。</p>'
  } else if (page === 'history') {
    toolbar.innerHTML = button('刷新', 'refresh')
    content.innerHTML = snapshot.history.length
      ? '<div class="list">' +
        snapshot.history
          .map((record) =>
            row(
              record.name,
              `${date(record.startedAt)} · ${escape(record.detail)}`,
              button('查看', 'viewRecord', record.id, 'small'),
              `<span class="badge ${record.status === 'failed' ? 'failed' : record.status === 'partial' ? 'partial' : ''}">${statusNames[record.status]}</span>`,
            ),
          )
          .join('') +
        '</div>'
      : '<div class="empty"><h2>暂无运行记录</h2><p>执行任务后，结果会显示在这里。</p></div>'
  } else {
    content.innerHTML = `<div class="settings"><div class="list"><div class="row"><div class="row-info"><h3>登录 Mac 时启动</h3><div class="meta">在登录账户后启动应用并恢复调度</div></div><input id="login-toggle" type="checkbox" aria-label="登录时启动" ${snapshot.preferences.startAtLogin ? 'checked' : ''}></div></div><p class="section-note">关闭窗口后任务继续运行。退出应用、关机或睡眠期间暂停执行，恢复后逾期任务补跑一次。所有时间采用北京时间。</p><p class="section-note">运行记录保留最近 300 条。投递失败保留错误，支持手动重跑。中断后的任务请检查是否已送达再重试。</p></div>`
    getElement<HTMLElement>(document, '#login-toggle').addEventListener('change', async (event) => {
      try {
        await api.invoke('preferences', {
          startAtLogin: (event.target as HTMLInputElement).checked,
        })
        notice('启动设置已保存')
      } catch (error) {
        notice(errorMessage(error), true)
      }
    })
  }
}
function showForm(
  title: string,
  body: string,
  submit: (form: HTMLFormElement) => Promise<unknown>,
) {
  dialogContent.innerHTML = `<h2>${title}</h2><form>${body}<div class="form-error" role="alert"></div><div class="form-footer"><button type="button" data-close>取消</button><button class="primary" type="submit">保存</button></div></form>`
  dialog.showModal()
  dialogContent.scrollTop = 0
  enhanceNumbers(dialogContent)
  getElement<HTMLButtonElement>(dialogContent, '[data-close]').onclick = () => dialog.close()
  getElement<HTMLFormElement>(dialogContent, 'form').onsubmit = async (event) => {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    if (!form.checkValidity()) {
      const invalid = getElement<HTMLInputElement>(form, ':invalid')
      getElement<HTMLElement>(form, '.form-error').textContent = invalid.validationMessage
      invalid.focus()
      return
    }
    const save = getElement<HTMLButtonElement>(form, '[type=submit]')
    save.disabled = true
    try {
      await submit(form)
      dialog.close()
      await refresh()
      notice('已保存')
    } catch (error) {
      getElement<HTMLElement>(form, '.form-error').textContent = errorMessage(error)
    } finally {
      save.disabled = false
    }
  }
  getElement<HTMLFormElement>(dialogContent, 'form').noValidate = true
}
function editChannel(id?: string) {
  const channel: Partial<Channel> = snapshot.channels.find((entry) => entry.id === id) || {}
  const kind = channel.kind || 'dingdong'
  showForm(
    id ? '编辑渠道' : '添加推送渠道',
    field('渠道名称', 'name', channel.name, 'text', 'required') +
      '<label>接收方式<select name="kind">' +
      option('dingdong', '叮咚 App · 自建中转', kind) +
      option('sc3', 'Server 酱³ App', kind) +
      option('turbo', 'Server 酱 Turbo', kind) +
      '</select></label>' +
      '<div id="relay-fields">' +
      field(
        '服务器地址',
        'baseUrl',
        channel.baseUrl || '',
        'text',
        'placeholder="http://服务器IP:8080 或 https://你的域名"',
      ) +
      field('消息来源', 'source', channel.source || 'MiniPush') +
      '<label class="check"><input type="checkbox" name="silent" ' +
      (channel.silent ? 'checked' : '') +
      '>静默保存（不弹通知）</label></div>' +
      field(
        '发送密钥',
        'key',
        '',
        'password',
        id ? 'placeholder="地址不变时，留空沿用已保存密钥"' : 'required',
      ) +
      '<p id="channel-help" class="help"></p>',
    (form) => {
      const fields = values(form)
      return api.invoke('saveChannel', {
        id,
        name: fields.name,
        kind: fields.kind,
        key: fields.key,
        baseUrl: fields.baseUrl,
        source: fields.source,
        silent: checked(form, 'silent'),
      })
    },
  )
  const form = getElement<HTMLFormElement>(dialogContent, 'form')
  const update = () => {
    const relay = control(form, 'kind').value === 'dingdong'
    getElement<HTMLElement>(form, '#relay-fields').hidden = !relay
    getElement<HTMLElement>(form, '#channel-help').textContent = relay
      ? '填写服务器的 DINGDONG_SEND_TOKEN，手机接收密钥不能用于发送。图片会压缩内嵌；运行记录可查询手机是否已保存。HTTP 地址不会加密传输，支持填写 HTTPS。'
      : '填写接收账号的 SendKey，应用自动生成对应发送地址。'
  }
  control(form, 'kind').onchange = update
  update()
}
function editProvider(id?: string) {
  const provider: Partial<Provider> = snapshot.providers.find((entry) => entry.id === id) || {}
  showForm(
    id ? '编辑 AI 配置' : '添加 AI 配置',
    field('名称', 'name', provider.name || 'OpenAI', 'text', 'required') +
      field(
        'API 基础地址',
        'baseUrl',
        provider.baseUrl || 'https://api.openai.com/v1',
        'url',
        'required',
      ) +
      '<span class="help">使用 OpenAI Responses 协议，地址包含 /v1。</span>' +
      field(
        'API Key',
        'key',
        '',
        'password',
        id ? 'placeholder="留空沿用已保存密钥"' : 'required',
      ) +
      `<fieldset class="model-picker"><legend>模型</legend><div class="model-toolbar"><button type="button" id="fetch-models">获取模型列表</button><button type="button" class="link" id="manual-model">手动填写</button></div><label hidden>筛选模型<input id="model-search" type="search" placeholder="输入名称，例如 gpt" autocomplete="off"></label><div id="model-control"><select name="model" aria-label="模型" required>${option(provider.model || 'gpt-4.1-mini', provider.model || 'gpt-4.1-mini', provider.model || 'gpt-4.1-mini')}</select></div><span class="help" id="model-status" role="status">通过当前 API 地址和 Key 获取可用模型。</span><span class="help">列表也可能包含图像、语音等模型。用于插件文本生成前，请保存并点击「测试 AI」确认兼容性。</span></fieldset>` +
      field(
        '单次输出上限',
        'maxOutputTokens',
        provider.maxOutputTokens || 1500,
        'number',
        'min="64" max="16000" required',
      ),
    (form) => {
      const fields = values(form)
      return api.invoke('saveProvider', {
        id,
        name: fields.name,
        baseUrl: fields.baseUrl,
        key: fields.key,
        model: fields.model,
        maxOutputTokens: fields.maxOutputTokens,
      })
    },
  )
  setupModelPicker(getElement<HTMLFormElement>(dialogContent, 'form'), api, id)
}
function pluginFields(pluginId: string, config: PluginConfig = {}) {
  const plugin = snapshot.plugins.find((entry) => entry.id === pluginId)
  if (!plugin) {
    return ''
  }
  return plugin.fields
    .map((entry) => {
      const value = config[entry.key] ?? entry.default ?? ''
      const name = 'plugin.' + entry.key
      if (entry.type === 'tasks') {
        const selected = String(value).split(',')
        const sources = snapshot.tasks.filter((task) => task.pluginId !== DIGEST_ID)
        return (
          '<div class="digest-sources">' +
          (sources.length
            ? sources
                .map(
                  (task) =>
                    `<label class="check"><input type="checkbox" data-source-task value="${escape(task.id)}" ${selected.includes(task.id) ? 'checked' : ''}>${escape(task.name)}</label>`,
                )
                .join('')
            : '<p class="help">先创建订阅任务，再选为内容源。</p>') +
          '<p class="help">沿用每个来源的配置与 AI。启用汇总会停止所选来源的独立定时；移除来源后，可自行重新启用。任一来源失败时，本轮不发送，保留去重记录等待重试。</p></div>'
        )
      }
      if (entry.type === 'forums') {
        return forumListHTML(value, escape)
      }
      if (entry.type === 'boolean') {
        return check(entry.label, name, value)
      }
      if (entry.type === 'textarea') {
        return `<label>${escape(entry.label)}<textarea name="${name}" ${entry.required ? 'required' : ''}>${escape(value)}</textarea></label>`
      }
      return field(
        entry.label,
        name,
        value,
        entry.type === 'number' ? 'number' : 'text',
        entry.required ? 'required' : '',
      )
    })
    .join('')
}
function editTask(id?: string, draft: TaskDraft = {}) {
  if (!snapshot.plugins.length || !snapshot.channels.length) {
    notice('请先在「插件」安装或导入一个插件，并在「推送渠道」添加接收账号。', true)
    return
  }
  const task = snapshot.tasks.find((entry) => entry.id === id) || draft
  const pluginId = task.pluginId || snapshot.plugins[0].id
  showForm(
    id ? '编辑任务' : '新建任务',
    field('任务名称', 'name', task.name || '', 'text', 'required') +
      `<label>插件<select name="pluginId">${snapshot.plugins.map((entry) => option(entry.id, entry.name, pluginId)).join('')}</select></label>` +
      '<div class="two-columns">' +
      `<label>发送到<select name="channelId">${snapshot.channels.map((entry) => option(entry.id, entry.name, task.channelId)).join('')}</select></label>` +
      `<label id="provider-field">插件可用的 AI<select name="providerId">${option('', '不使用 AI', task.providerId || '')}${snapshot.providers.map((entry) => option(entry.id, entry.name, task.providerId)).join('')}</select></label></div>` +
      '<div class="schedule-settings">' +
      `<label>执行方式<select name="scheduleType">${option('manual', '仅手动', task.schedule?.type || 'manual')}${option('daily', '每天定点（可多个）', task.schedule?.type)}${option('interval', '固定间隔', task.schedule?.type)}</select></label><div id="schedule-detail"></div></div>` +
      check('启用任务', 'enabled', task.enabled ?? true) +
      check('仅内容变化时推送', 'onlyChanged', task.onlyChanged ?? true) +
      `<fieldset><legend>插件配置</legend><div id="plugin-fields"></div></fieldset>`,
    (form) => {
      const fields = values(form)
      const plugin = snapshot.plugins.find((entry) => entry.id === fields.pluginId)
      const config: PluginConfig = {}
      if (!plugin) {
        throw new Error('请选择插件')
      }
      for (const entry of plugin.fields) {
        if (entry.type === 'tasks') {
          config[entry.key] = [
            ...form.querySelectorAll<HTMLInputElement>('[data-source-task]:checked'),
          ]
            .map((input) => input.value)
            .join(',')
        } else if (entry.type === 'forums') {
          config[entry.key] = readForumList(getElement<HTMLElement>(form, '#plugin-fields'))
        } else {
          const element = control(form, 'plugin.' + entry.key)
          config[entry.key] =
            entry.type === 'boolean' ? checked(form, 'plugin.' + entry.key) : element.value
        }
      }
      if (
        ['tieba-subscription', 'x-interests', 'xiaohongshu-interests'].includes(plugin.id) &&
        !fields.providerId
      ) {
        throw new Error('兴趣筛选需要选择一个 AI 配置')
      }
      return api.invoke('saveTask', {
        id,
        name: fields.name,
        pluginId: fields.pluginId,
        channelId: fields.channelId,
        providerId: plugin.id === DIGEST_ID ? '' : fields.providerId,
        enabled: checked(form, 'enabled'),
        onlyChanged: checked(form, 'onlyChanged'),
        config,
        schedule: {
          type: fields.scheduleType,
          times:
            fields.scheduleType === 'daily'
              ? readTimes(getElement<HTMLElement>(form, '#schedule-detail'))
              : undefined,
          minutes: fields.minutes,
        },
      })
    },
  )
  const form = getElement<HTMLFormElement>(dialogContent, 'form')
  let dailyTimes = task.schedule?.times || [task.schedule?.time || '04:00']
  let intervalMinutes = task.schedule?.minutes || 60
  const updateSchedule = () => {
    const detail = getElement<HTMLElement>(form, '#schedule-detail')
    if (detail.querySelector<HTMLInputElement>('.daily-time')) {
      dailyTimes = readTimes(detail)
    }
    if (detail.querySelector<HTMLInputElement>('[name="minutes"]')) {
      intervalMinutes = control(form, 'minutes').value
    }
    const type = control(form, 'scheduleType').value
    let html = '<span class="help">点击「立即执行」开始任务</span>'
    if (type === 'daily') {
      html = timesHTML(dailyTimes, escape)
    } else if (type === 'interval') {
      html = field(
        '间隔（分钟）',
        'minutes',
        intervalMinutes,
        'number',
        'min="1" max="10080" required',
      )
    }
    getElement<HTMLElement>(document, '#schedule-detail').innerHTML = html
    enhanceNumbers(getElement<HTMLElement>(document, '#schedule-detail'))
    bindTimes(getElement<HTMLElement>(document, '#schedule-detail'), escape)
  }
  getElement<HTMLElement>(document, '#plugin-fields').innerHTML = pluginFields(
    pluginId,
    task.config,
  )
  enhanceNumbers(getElement<HTMLElement>(document, '#plugin-fields'))
  bindForumLists(getElement<HTMLElement>(document, '#plugin-fields'), escape)
  getElement<HTMLElement>(form, '#provider-field').hidden = pluginId === DIGEST_ID
  control(form, 'pluginId').onchange = () => {
    getElement<HTMLElement>(form, '#provider-field').hidden =
      control(form, 'pluginId').value === DIGEST_ID
    getElement<HTMLElement>(document, '#plugin-fields').innerHTML = pluginFields(
      control(form, 'pluginId').value,
    )
    enhanceNumbers(getElement<HTMLElement>(document, '#plugin-fields'))
    bindForumLists(getElement<HTMLElement>(document, '#plugin-fields'), escape)
  }
  control(form, 'scheduleType').onchange = updateSchedule
  updateSchedule()
}
function viewRecord(id?: string) {
  const record = snapshot.history.find((entry) => entry.id === id)
  if (!record) {
    throw new Error('运行记录不存在')
  }
  const messageText = record.message?.sections
    ? record.message.sections
        .map((section) => section.name + '\n\n' + section.message.body)
        .join('\n\n────────\n\n')
    : record.message?.body || ''
  dialogContent.innerHTML = `<h2>${escape(record.name)}</h2><p>${escape(record.detail)}</p><p class="meta">${date(record.startedAt)} · ${statusNames[record.status]}</p>${record.delivery ? `<p class="meta">叮咚：${{ unknown: '提交状态待确认', queued: '等待手机保存', received: '手机已保存' }[record.delivery.status]}</p><button id="check-delivery">查询送达状态</button><p id="delivery-status" class="help"></p>` : ''}${record.message ? '<button id="preview-delivery">预览 HTML 正文</button>' : ''}${record.sourceFailures?.length ? `<ul class="source-failures">${record.sourceFailures.map((source) => `<li><strong>${escape(source.name)}</strong>：${escape(source.detail)}</li>`).join('')}</ul>` : ''}${toolTraceHTML(record.trace, escape)}<pre>${escape(record.message ? record.message.title + '\n\n' + messageText : '无消息正文')}</pre><div class="form-footer"><button data-close>关闭</button></div>`
  dialog.showModal()
  dialogContent.scrollTop = 0
  getElement<HTMLButtonElement>(dialogContent, '[data-close]').onclick = () => dialog.close()
  const check = dialogContent.querySelector<HTMLButtonElement>('#check-delivery')
  if (check) {
    check.onclick = async () => {
      check.disabled = true
      const status = getElement<HTMLElement>(dialogContent, '#delivery-status')
      try {
        status.textContent = await api.invoke('checkDelivery', record.id)
      } catch (error) {
        status.textContent = errorMessage(error)
      } finally {
        check.disabled = false
      }
    }
  }
  const preview = dialogContent.querySelector<HTMLButtonElement>('#preview-delivery')
  if (preview) {
    preview.onclick = async () => {
      preview.disabled = true
      try {
        await api.invoke('previewDelivery', record.id)
      } catch (error) {
        notice(errorMessage(error), true)
      } finally {
        preview.disabled = false
      }
    }
  }
}
function confirmDeletion() {
  return new Promise<boolean>((resolve) => {
    dialogContent.innerHTML =
      '<h2>删除此项？</h2><p>删除后无法恢复。</p><div class="form-footer"><button type="button" data-cancel>取消</button><button type="button" class="danger" data-confirm>确认删除</button></div>'
    let confirmed = false
    dialog.addEventListener('close', () => resolve(confirmed), { once: true })
    getElement<HTMLButtonElement>(dialogContent, '[data-cancel]').onclick = () => dialog.close()
    getElement<HTMLButtonElement>(dialogContent, '[data-confirm]').onclick = () => {
      confirmed = true
      dialog.close()
    }
    dialog.showModal()
    dialogContent.scrollTop = 0
    getElement<HTMLButtonElement>(dialogContent, '[data-cancel]').focus()
  })
}
async function handleAction(event: MouseEvent) {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]')
  if (!target) {
    return
  }
  const { action, id } = target.dataset
  const editors: Record<string, (id?: string) => void> = {
    editTask,
    createDigest: () =>
      editTask(undefined, {
        name: '订阅汇总',
        pluginId: DIGEST_ID,
        schedule: { type: 'interval', minutes: 60 },
        config: {
          sourceTaskIds: snapshot.tasks
            .filter((task) => task.pluginId !== DIGEST_ID)
            .map((task) => task.id)
            .join(','),
        },
      }),
    editChannel,
    editProvider,
    viewRecord,
    manageXHS: () =>
      openXHS({
        dialog,
        content: dialogContent,
        api,
        escape,
        providers: snapshot.providers,
        onCreate: (draft) => editTask(undefined, draft),
      }),
    manageX: () =>
      openX({
        dialog,
        content: dialogContent,
        api,
        escape,
        providers: snapshot.providers,
        onCreate: (draft) => editTask(undefined, draft),
      }),
    manageTieba: () =>
      openTieba({
        dialog,
        content: dialogContent,
        api,
        escape,
        providers: snapshot.providers,
        onCreate: (draft) => editTask(undefined, draft),
      }),
    manageBilibili: () =>
      openBilibili({
        dialog,
        content: dialogContent,
        api,
        escape,
        onCreate: (draft) => editTask(undefined, draft),
      }),
  }
  if (!action) {
    return
  }
  if (editors[action]) {
    editors[action](id)
    return
  }
  if (action.startsWith('delete') && !(await confirmDeletion())) {
    return
  }
  target.disabled = true
  try {
    if (action === 'refresh') {
      await refresh()
      return
    }
    if (action === 'runTask') {
      const response = await api.invoke('runTask', id!)
      notice(response.detail, response.status === 'failed')
    } else if (action === 'testProvider' || action === 'testChannel') {
      notice(await api.invoke(action, id!))
    } else {
      const operations: Record<string, () => Promise<unknown>> = {
        addExample: () => api.invoke('addExample'),
        importPlugin: () => api.invoke('importPlugin'),
        installBilibili: () => api.invoke('installBilibili'),
        installTieba: () => api.invoke('installTieba'),
        installXHS: () => api.invoke('installXHS'),
        installX: () => api.invoke('installX'),
        deletePlugin: () => api.invoke('deletePlugin', id!),
        deleteChannel: () => api.invoke('deleteChannel', id!),
        deleteProvider: () => api.invoke('deleteProvider', id!),
        deleteTask: () => api.invoke('deleteTask', id!),
        toggleTask: () => api.invoke('toggleTask', id!),
        cancelTask: () => api.invoke('cancelTask', id!),
        openExamples: () => api.invoke('openExamples'),
      }
      const operation = operations[action]
      if (!operation) {
        throw new Error('未知操作')
      }
      const response = await operation()
      if (action === 'importPlugin' && !response) {
        return
      }
      notice('操作完成')
    }
    await refresh()
  } catch (error) {
    notice(errorMessage(error), true)
  } finally {
    target.disabled = false
  }
}
document.addEventListener('click', handleAction)
document.querySelectorAll<HTMLElement>('[data-page]').forEach((element) => {
  element.innerHTML = `<span class="nav-icon ${element.dataset.page}">${icon(element.dataset.page)}</span><span>${element.textContent}</span>`
  element.onclick = () => {
    page = element.dataset.page as keyof typeof titles
    getElement<HTMLElement>(document, '#notice').hidden = true
    render()
  }
})
api.onChange(() => {
  void refresh()
})
void refresh().catch((error) => notice(errorMessage(error), true))
