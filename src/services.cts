import type { Xiaohongshu } from './xiaohongshu.cjs'
import { sendDingdong, deliveryStatus, type DeliveryOptions } from './dingdong.cjs'
import type { ImageLoader } from './dingdong-document.cjs'
import { channelConnection } from './channels.cjs'
import type { ChannelInput } from './types.cjs'
import type { XSourceService } from './x.cjs'
import type { Store } from './store.cjs'
import type { Bilibili } from './bilibili.cjs'
import type { Tieba } from './tieba.cjs'
import type {
  ProviderInput,
  Fetcher,
  Message,
  ToolRequest,
  ToolResponse,
  ResponseItem,
} from './types.cjs'
interface ServiceResponse {
  data?: Array<{ id?: unknown }>
  error?: { code?: string }
  code?: string | number
  status?: string
  output?: ResponseItem[]
}
import { channelEndpoint } from './domain.cjs'
import { requiredText } from './domain.cjs'

class Services {
  xiaohongshu!: Xiaohongshu
  x!: XSourceService
  bilibili!: Bilibili
  tieba!: Tieba
  constructor(
    public store: Pick<Store, 'state' | 'decrypt'>,
    public fetcher: Fetcher,
    public imageLoader?: ImageLoader,
  ) {}

  channelConnection(input: ChannelInput) {
    const existing = this.store.state.channels.find((entry) => entry.id === input.id)
    return channelConnection(input, existing, (secret) => this.store.decrypt(secret))
  }
  async deliveryStatus(channelId: string, id: string) {
    const channel = this.store.state.channels.find((entry) => entry.id === channelId)
    if (!channel || channel.kind !== 'dingdong') {
      throw new Error('原叮咚渠道已删除或变更')
    }
    return deliveryStatus(this.fetcher, channel, this.store.decrypt(channel.secret), id)
  }

  providerConnection(input: ProviderInput) {
    const existing = this.store.state.providers.find((entry) => entry.id === input.id)
    let url
    try {
      url = new URL(requiredText(input.baseUrl, 'API 地址'))
    } catch {
      throw new Error('请输入有效的 HTTPS API 基础地址')
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('请输入有效的 HTTPS API 基础地址')
    }
    const baseUrl = url.href.replace(/\/$/, '')
    let key = input.key?.trim()
    if (!key && existing) {
      if (baseUrl !== existing.baseUrl) {
        throw new Error('API 地址已更改，请重新填写此地址对应的 API Key')
      }
      key = this.store.decrypt(existing.secret)
    }
    key = requiredText(key, 'API Key', 1000)
    return { baseUrl, key }
  }

  async listModels(input: ProviderInput) {
    const { baseUrl, key } = this.providerConnection(input)
    const body = await this.request(baseUrl + '/models', {
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!Array.isArray(body.data)) {
      throw new Error('服务未返回有效的模型列表，请检查 API 地址是否支持 /models')
    }
    const models = [
      ...new Set(
        body.data
          .map((entry) => entry?.id)
          .filter(
            (id): id is string => typeof id === 'string' && Boolean(id.trim()) && id.length <= 300,
          ),
      ),
    ].sort((first, second) => first.localeCompare(second, 'en', { numeric: true }))
    if (!models.length) {
      throw new Error('这个 Key 暂未返回可用模型，请检查项目权限，或手动填写模型 ID')
    }
    return models
  }

  async request(url: string, options: RequestInit, signal?: AbortSignal): Promise<ServiceResponse> {
    let response
    try {
      response = await this.fetcher(url, {
        ...options,
        signal: AbortSignal.any([AbortSignal.timeout(90000), ...(signal ? [signal] : [])]),
      })
    } catch {
      throw new Error('网络请求失败或超时，请检查网络、系统代理和服务地址')
    }
    const body = (await response.json().catch(() => ({}))) as ServiceResponse
    if (!response.ok) {
      const code = body.error?.code || body.code || response.status
      throw new Error(`服务返回 HTTP ${response.status}（${code}）`)
    }
    return body
  }

  async send(
    channelId: string,
    message: Message,
    signal?: AbortSignal,
    delivery?: DeliveryOptions,
  ) {
    const channel = this.store.state.channels.find((entry) => entry.id === channelId)
    if (!channel) {
      throw new Error('推送渠道不存在')
    }
    const key = this.store.decrypt(channel.secret)
    if (channel.kind === 'dingdong') {
      return sendDingdong(this.fetcher, channel, key, message, this.imageLoader, signal, delivery)
    }
    if (message.format && message.format !== 'markdown') {
      throw new Error('此消息需要 HTML/文本渠道，请选择叮咚')
    }
    const body = await this.request(
      channelEndpoint(channel.kind, key),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: message.title,
          desp: message.body,
          short: message.short || '',
          tags: 'MiniPush',
        }),
      },
      signal,
    )
    if (body.code !== 0) {
      throw new Error(`Server 酱拒绝了推送（状态码 ${body.code ?? '未知'}）`)
    }
    return '推送服务已接受消息'
  }

  async respond(
    providerId: string,
    request: ToolRequest,
    signal?: AbortSignal,
  ): Promise<ToolResponse> {
    const provider = this.store.state.providers.find((entry) => entry.id === providerId)
    if (!provider) {
      throw new Error('请为任务选择 AI 配置')
    }
    if (
      typeof request?.instructions !== 'string' ||
      request.instructions.length > 16000 ||
      !Array.isArray(request.input) ||
      request.input.length > 80 ||
      !Array.isArray(request.tools) ||
      !request.tools.length ||
      request.tools.length > 12 ||
      request.tools.some((tool) => tool.type !== 'function' || typeof tool.name !== 'string') ||
      JSON.stringify(request).length > 300000
    ) {
      throw new Error('AI 工具请求格式无效或超出大小限制')
    }
    const body = await this.request(
      provider.baseUrl + '/responses',
      {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${this.store.decrypt(provider.secret)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: provider.model,
          instructions: request.instructions,
          input: request.input,
          tools: request.tools,
          tool_choice: 'required',
          parallel_tool_calls: false,
          include: ['reasoning.encrypted_content'],
          max_output_tokens: provider.maxOutputTokens,
          store: false,
        }),
      },
      signal,
    )
    if (
      body.status !== 'completed' ||
      !Array.isArray(body.output) ||
      JSON.stringify(body.output).length > 200000
    ) {
      throw new Error('AI 工具响应不完整，请检查模型能力或提高输出上限后重试')
    }
    const calls = body.output.filter((item) => item.type === 'function_call')
    if (calls.length !== 1 || !calls[0].call_id || typeof calls[0].arguments !== 'string') {
      throw new Error('AI 未返回单个有效工具调用，请使用支持 Responses 工具调用的模型')
    }
    // Replay all output items, including encrypted reasoning, for stateless continuation.
    return { output: body.output }
  }

  async generate(providerId: string, prompt: string, signal?: AbortSignal) {
    const provider = this.store.state.providers.find((entry) => entry.id === providerId)
    if (!provider) {
      throw new Error('请为任务选择 AI 配置')
    }
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 100000) {
      throw new Error('AI 输入为空或超过 100000 字符')
    }
    const body = await this.request(
      provider.baseUrl + '/responses',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.store.decrypt(provider.secret)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: provider.model,
          input: prompt,
          max_output_tokens: provider.maxOutputTokens,
          store: false,
        }),
      },
      signal,
    )
    const output = (body.output || [])
      .flatMap((entry) => (Array.isArray(entry.content) ? entry.content : []))
      .filter((entry) => entry.type === 'output_text')
      .map((entry) => entry.text)
      .join('\n')
    if (!output) {
      throw new Error('AI 未返回文本，请检查模型或提高输出上限')
    }
    return output
  }
}

export { Services }
