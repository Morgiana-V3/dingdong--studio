import crypto from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { Channel, Fetcher, Message } from './types.cjs'
import { relayAddress } from './channels.cjs'
import { dingdongDocument, type ImageLoader } from './dingdong-document.cjs'

export type DeliveryStatus = 'queued' | 'received'
export interface DeliveryOptions {
  id: string
  onStatus(status: DeliveryStatus): void
}
export async function relayRequest(
  fetcher: Fetcher,
  baseUrl: string,
  key: string,
  path: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<{ id: string; status: DeliveryStatus }> {
  const encoded = payload === undefined ? undefined : JSON.stringify(payload)
  if (encoded && Buffer.byteLength(encoded) > 2000000) {
    throw new Error('叮咚请求超过 2 MB，请减少消息内容')
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted()
    let response
    try {
      response = await fetcher(relayAddress(baseUrl) + path, {
        method: encoded ? 'POST' : 'GET',
        redirect: 'error',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: encoded,
        signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]),
      })
    } catch {
      signal?.throwIfAborted()
      if (attempt === 2) {
        throw new Error('叮咚连接失败或超时；消息可能已提交，可在运行记录查询送达状态')
      }
    }
    if (response) {
      if (response.ok) {
        const result = (await response.json().catch(() => undefined)) as
          { id?: unknown; status?: unknown } | undefined
        if (
          !result ||
          typeof result.id !== 'string' ||
          !['queued', 'received'].includes(String(result.status))
        ) {
          throw new Error('叮咚返回格式不正确，无法确认提交状态')
        }
        return result as { id: string; status: DeliveryStatus }
      }
      if ((![408, 429].includes(response.status) && response.status < 500) || attempt === 2) {
        const descriptions: Record<number, string> = {
          401: '发送密钥无效，请填写 DINGDONG_SEND_TOKEN（不是手机接收密钥）',
          404: '服务器地址或消息 ID 不存在',
          409: '相同消息 ID 对应不同内容，请检查重试记录',
          413: '消息超过服务器大小限制',
          422: '消息字段不符合叮咚协议',
          507: '服务器待收队列已满，请先让手机接收',
        }
        throw new Error(
          `叮咚 HTTP ${response.status}：${descriptions[response.status] || '请求未成功，请检查服务状态'}`,
        )
      }
    }
    await delay(400 * 2 ** attempt, undefined, { signal })
  }
  throw new Error('叮咚请求失败')
}
export async function deliveryStatus(
  fetcher: Fetcher,
  channel: Channel,
  key: string,
  id: string,
  signal?: AbortSignal,
) {
  if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(id)) {
    throw new Error('消息 ID 无效')
  }
  const result = await relayRequest(
    fetcher,
    channel.baseUrl || '',
    key,
    `/v1/messages/${id}/status`,
    undefined,
    signal,
  )
  if (result.id !== id) {
    throw new Error('叮咚返回的消息 ID 不匹配')
  }
  return result.status
}
export async function sendDingdong(
  fetcher: Fetcher,
  channel: Channel,
  key: string,
  message: Message,
  imageLoader?: ImageLoader,
  signal?: AbortSignal,
  delivery?: DeliveryOptions,
) {
  const document = await dingdongDocument(message, imageLoader, signal)
  const id = delivery?.id || crypto.randomUUID()
  const payload = {
    id,
    source: channel.source || 'MiniPush',
    title: message.title,
    summary: message.short || '',
    format: 'html',
    content: document.content,
    priority: channel.silent ? 'silent' : 'normal',
  }
  if (
    !payload.title.trim() ||
    [...payload.title].length > 160 ||
    [...payload.summary].length > 500
  ) {
    throw new Error('叮咚标题最多 160 字、摘要最多 500 字')
  }
  // Build once; all retries reuse the exact ID, content and embedded image bytes.
  const result = await relayRequest(
    fetcher,
    channel.baseUrl || '',
    key,
    '/v1/messages',
    payload,
    signal,
  )
  if (result.id !== id) {
    throw new Error('叮咚返回的消息 ID 不匹配，无法确认提交状态')
  }
  delivery?.onStatus(result.status)
  const detail =
    result.status === 'received' ? '叮咚手机已保存正文' : '叮咚服务器已接收，等待手机保存'
  if (!document.omitted) return detail
  const photos = document.imageFailures.filter((item) => item.kind === 'photo').length
  const emoticons = document.imageFailures.length - photos
  const reasons = [...new Set(document.imageFailures.map((item) => `${item.host}：${item.reason}`))]
    .slice(0, 6)
    .join('；')
  return `${detail}${photos ? `；${photos} 张配图未能附入` : ''}${emoticons ? `；${emoticons} 个表情改为文字` : ''}（${reasons}）`
}
