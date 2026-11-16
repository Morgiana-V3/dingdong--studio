import type { Channel, ChannelInput } from './types.cjs'
import { channelEndpoint, requiredText } from './domain.cjs'

export function relayAddress(input: string): string {
  let url: URL
  try {
    url = new URL(input.includes('://') ? input.trim() : 'http://' + input.trim())
  } catch {
    throw new Error('请输入叮咚服务器地址，例如 http://192.168.1.10:8080')
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('服务器地址只能使用 HTTP/HTTPS，不能包含密钥、查询参数或片段')
  }
  return url.href.replace(/\/+$/, '')
}
export function channelConnection(
  input: ChannelInput,
  existing: Channel | undefined,
  decrypt: (secret?: string) => string,
) {
  const baseUrl =
    input.kind === 'dingdong' ? relayAddress(requiredText(input.baseUrl, '服务器地址')) : undefined
  let key = input.key?.trim()
  if (!key && existing) {
    if (existing.kind !== input.kind || existing.baseUrl !== baseUrl) {
      throw new Error('接收方式或服务器地址已更改，请重新填写对应的发送密钥')
    }
    key = decrypt(existing.secret)
  }
  key = requiredText(key, '发送密钥', 1000)
  if (input.kind === 'dingdong') {
    if (key.length < 32 || /[\s\x00-\x1f\x7f]/.test(key)) {
      throw new Error('叮咚发送密钥需至少 32 个字符，不能含空白或控制字符')
    }
    return {
      key,
      baseUrl,
      source: requiredText(input.source || 'MiniPush', '来源名称', 64),
      silent: input.silent === true,
    }
  }
  channelEndpoint(input.kind, key)
  return { key }
}
