import fs from 'node:fs'
import { ClientTransaction, fetchXDocument } from 'x-client-transaction-id'
import type { XCookie } from './x-credentials.cjs'

export type XOperation = 'SearchTimeline' | 'TweetDetail' | 'HomeLatestTimeline'
interface Endpoint {
  queryId: string
  features: Record<string, boolean>
}
interface Metadata {
  fetchedAt: number
  endpoints: Record<XOperation, Endpoint>
}
interface Signer {
  generateTransactionId(method: string, path: string): Promise<string>
}
interface Options {
  fetcher?: typeof fetch
  createSigner?: () => Promise<Signer>
  metadataUrl?: string
}
const metadataUrl =
  'https://raw.githubusercontent.com/fa0311/TwitterInternalAPIDocument/master/docs/json/API.json'
// Public token shipped by X's web client; this is not a user's credential.
const webBearer =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
export function parseMetadata(input: unknown): Record<XOperation, Endpoint> {
  const graphql = record(record(input).graphql)
  const endpoints = {} as Record<XOperation, Endpoint>
  for (const operation of ['SearchTimeline', 'TweetDetail', 'HomeLatestTimeline'] as const) {
    const endpoint = record(graphql[operation])
    const features = record(endpoint.features)
    if (
      typeof endpoint.queryId !== 'string' ||
      !/^[\w-]{10,100}$/.test(endpoint.queryId) ||
      endpoint.method !== 'GET' ||
      !Object.keys(features).length ||
      Object.keys(features).length > 200 ||
      Object.entries(features).some(
        ([name, value]) => !/^\w{1,150}$/.test(name) || typeof value !== 'boolean',
      )
    ) {
      throw new Error('X 接口参数格式已变化，请更新读取适配')
    }
    // Never trust a downloaded endpoint URL or copy credentials into metadata requests.
    endpoints[operation] = {
      queryId: endpoint.queryId,
      features: features as Record<string, boolean>,
    }
  }
  return endpoints
}
async function boundedJSON(response: Response): Promise<unknown> {
  if (!response.body) {
    throw new Error('X 返回空响应')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        break
      }
      size += value.length
      if (size > 8_000_000) {
        throw new Error('X 响应过大，请缩小搜索范围')
      }
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
export class XHTTPClient {
  private metadata?: Metadata
  private signer?: Signer
  private fetcher: typeof fetch
  private createSigner: () => Promise<Signer>
  private metadataUrl: string
  constructor(
    private cacheFile?: string,
    options: Options = {},
  ) {
    this.fetcher = options.fetcher || fetch
    this.createSigner =
      options.createSigner || (async () => ClientTransaction.create(await fetchXDocument()))
    this.metadataUrl = options.metadataUrl || metadataUrl
  }
  private async parameters(force: boolean): Promise<Metadata> {
    if (!this.metadata && this.cacheFile && fs.existsSync(this.cacheFile)) {
      try {
        const cached = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8')) as Metadata
        if (
          !Number.isFinite(cached.fetchedAt) ||
          cached.fetchedAt <= 0 ||
          cached.fetchedAt > Date.now()
        ) {
          throw new Error('Invalid cache timestamp')
        }
        const graphql = Object.fromEntries(
          Object.entries(cached.endpoints).map(([name, value]) => [
            name,
            { ...value, method: 'GET' },
          ]),
        )
        this.metadata = { fetchedAt: cached.fetchedAt, endpoints: parseMetadata({ graphql }) }
      } catch {
        /* Invalid public metadata is refetched. */
      }
    }
    if (!force && this.metadata && Date.now() - this.metadata.fetchedAt < 6 * 3600000) {
      return this.metadata
    }
    try {
      const response = await this.fetcher(this.metadataUrl, {
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
      })
      if (!response.ok) {
        throw new Error('metadata unavailable')
      }
      const metadata = {
        fetchedAt: Date.now(),
        endpoints: parseMetadata(await boundedJSON(response)),
      }
      if (this.cacheFile) {
        fs.writeFileSync(this.cacheFile + '.tmp', JSON.stringify(metadata), { mode: 0o600 })
        fs.renameSync(this.cacheFile + '.tmp', this.cacheFile)
      }
      this.metadata = metadata
      return metadata
    } catch {
      if (!force && this.metadata && Date.now() - this.metadata.fetchedAt < 7 * 86400000) {
        return this.metadata
      }
      throw new Error('无法更新 X 接口参数，请检查网络或代理后重试')
    }
  }
  async request(
    operation: XOperation,
    variables: Record<string, unknown>,
    cookies: XCookie[],
  ): Promise<unknown> {
    const csrf = cookies.find((cookie) => cookie.name === 'ct0')?.value
    if (!csrf || !cookies.some((cookie) => cookie.name === 'auth_token')) {
      throw new Error('X 登录凭据不完整，请重新导入')
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const metadata = await this.parameters(attempt > 0)
      if (!this.signer || attempt > 0) {
        this.signer = await this.createSigner()
      }
      const endpoint = metadata.endpoints[operation]
      const url = new URL(`https://x.com/i/api/graphql/${endpoint.queryId}/${operation}`)
      url.search = new URLSearchParams({
        variables: JSON.stringify(variables),
        features: JSON.stringify(endpoint.features),
        fieldToggles: JSON.stringify({
          withArticleRichContentState: false,
          withArticlePlainText: true,
        }),
      }).toString()
      const response = await this.fetcher(url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(45000),
        headers: {
          authorization: `Bearer ${webBearer}`,
          'x-csrf-token': csrf,
          'x-twitter-auth-type': 'OAuth2Session',
          'x-twitter-active-user': 'yes',
          'x-client-transaction-id': await this.signer.generateTransactionId('GET', url.pathname),
          cookie: cookies
            .filter((cookie) => ['auth_token', 'ct0', 'twid'].includes(cookie.name))
            .map((cookie) => `${cookie.name}=${cookie.value}`)
            .join('; '),
          'user-agent': 'Mozilla/5.0',
          accept: 'application/json',
        },
      })
      if ((response.status === 404 || response.status === 400) && attempt === 0) {
        await response.body?.cancel()
        continue
      }
      if (response.status === 429) {
        await response.body?.cancel()
        throw new Error('X 暂时限流，请稍后再试或降低任务频率')
      }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel()
        throw new Error('X 登录已失效或需要验证，请在官方网页处理后重新导入登录')
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`X 接口返回 HTTP ${response.status}，请稍后重试或更新读取适配`)
      }
      const data = await boundedJSON(response)
      const errors = record(data).errors
      if (Array.isArray(errors) && errors.length) {
        const codes = errors.map((error) => record(error).code)
        if (codes.some((code) => [32, 89, 215, 326].includes(Number(code)))) {
          throw new Error('X 登录已失效或需要验证，请重新导入登录')
        }
        throw new Error('X 接口返回读取错误，请稍后重试或检查登录状态')
      }
      return data
    }
    throw new Error('X 接口已变化，更新参数后仍无法读取')
  }
}
