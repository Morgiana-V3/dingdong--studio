import type { Schedule, ScheduleInput, Manifest, PluginConfig, Message } from './types.cjs'
import crypto from 'node:crypto'

function requiredText(value: unknown, name: string, maximum = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`${name}不能为空，且最多 ${maximum} 个字符`)
  }
  return value.trim()
}

function validateSchedule(schedule: ScheduleInput): Schedule {
  if (schedule?.type === 'manual') {
    return { type: 'manual' }
  }
  if (schedule?.type === 'interval') {
    const minutes = Number(schedule.minutes)
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) {
      throw new Error('执行间隔必须为 1–10080 分钟')
    }
    return { type: 'interval', minutes }
  }
  const times = schedule?.times ?? [schedule?.time]
  if (
    schedule?.type !== 'daily' ||
    !Array.isArray(times) ||
    !times.length ||
    times.length > 24 ||
    times.some((time) => typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
  ) {
    throw new Error('请配置 1–24 个有效的执行时间，格式为 HH:mm')
  }
  if (new Set(times).size !== times.length) {
    throw new Error('执行时间不能重复')
  }
  return { type: 'daily', times: [...(times as string[])].sort() }
}

function nextRun(input: ScheduleInput, now = Date.now()) {
  const schedule = validateSchedule(input)
  if (schedule.type === 'manual') {
    return null
  }
  if (schedule.type === 'interval') {
    return now + schedule.minutes * 60000
  }
  // Schedules use Asia/Shanghai (UTC+8), independent of the host timezone.
  return Math.min(
    ...schedule.times.map((time) => {
      const local = new Date(now + 8 * 3600000)
      const [hour, minute] = time.split(':').map(Number)
      local.setUTCHours(hour, minute, 0, 0)
      let next = local.getTime() - 8 * 3600000
      if (next <= now) {
        next += 86400000
      }
      return next
    }),
  )
}

function validateManifest(manifest: Manifest): Manifest {
  requiredText(manifest.id, '插件 ID', 64)
  if (!/^[a-z][a-z0-9-]*$/.test(manifest.id) || manifest.apiVersion !== 1) {
    throw new Error('插件 ID 格式错误，或 apiVersion 不为 1')
  }
  requiredText(manifest.name, '插件名称')
  requiredText(manifest.version, '插件版本')
  if (
    manifest.capabilities !== undefined &&
    (!Array.isArray(manifest.capabilities) ||
      manifest.capabilities.some(
        (capability) =>
          !['xiaohongshu.read', 'bilibili.read', 'tieba.read', 'x.read', 'ai.tools'].includes(
            capability,
          ),
      ))
  ) {
    throw new Error('插件请求了不支持的数据读取能力')
  }
  if (manifest.entry !== 'index.cjs') {
    throw new Error('插件入口须为 index.cjs')
  }
  if (!Array.isArray(manifest.fields) || manifest.fields.length > 30) {
    throw new Error('fields 必须为数组，最多 30 项')
  }
  const names = new Set()
  for (const field of manifest.fields) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field.key) || names.has(field.key)) {
      throw new Error('插件配置字段名称无效或重复')
    }
    names.add(field.key)
    requiredText(field.label, '字段标签')
    if (!['text', 'textarea', 'number', 'boolean', 'forums', 'tasks'].includes(field.type)) {
      throw new Error('插件字段类型不支持')
    }
  }
  return manifest
}

function validateConfig(manifest: Manifest, config: PluginConfig): PluginConfig {
  const validated: PluginConfig = {}
  for (const field of manifest.fields) {
    let value = config[field.key] ?? field.default ?? ''
    if (field.required && (value === '' || value === null)) {
      throw new Error(`请填写「${field.label}」`)
    }
    if (field.type === 'forums') {
      if (
        !Array.isArray(value) ||
        !value.length ||
        value.length > 5 ||
        value.some(
          (item) =>
            typeof item?.name !== 'string' ||
            item.name.length > 60 ||
            typeof item?.filter !== 'string' ||
            item.filter.length > 3000,
        )
      ) {
        throw new Error('贴吧配置需包含 1–5 个吧名和对应的过滤说明')
      }
      value = value.map((item) => ({ name: item.name.trim(), filter: item.filter.trim() }))
    } else if (field.type === 'number') {
      value = Number(value)
      if (!Number.isFinite(value)) {
        throw new Error(`「${field.label}」应为数字`)
      }
    } else if (field.type === 'boolean') {
      value = Boolean(value)
    } else if (typeof value !== 'string' || value.length > 50000) {
      throw new Error(`「${field.label}」格式无效或内容过长`)
    }
    validated[field.key] = value
  }
  return validated
}

function channelEndpoint(kind: string, key: string) {
  if (kind === 'sc3') {
    const matched = key.match(/^sctp(\d+)t[A-Za-z0-9_-]+$/)
    if (!matched) {
      throw new Error('Server 酱³ SendKey 格式无效')
    }
    return `https://${matched[1]}.push.ft07.com/send/${key}.send`
  }
  if (kind !== 'turbo' || !/^SCT[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error('Server 酱 Turbo SendKey 格式无效')
  }
  return `https://sctapi.ftqq.com/${key}.send`
}

function messageDigest(message: Message) {
  return crypto.createHash('sha256').update(JSON.stringify(message)).digest('hex')
}

export {
  requiredText,
  nextRun,
  validateSchedule,
  validateManifest,
  validateConfig,
  channelEndpoint,
  messageDigest,
}
