import type { Store } from '../../src/store.cjs'
import type { Channel, Provider, Settings } from '../../src/types.cjs'

// Only for partial native-process stubs and deliberately invalid boundary inputs in tests.
export function testDouble<T>(value: unknown): T {
  return value as T
}

export function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    version: 1,
    channels: [],
    providers: [],
    tasks: [],
    history: [],
    preferences: { startAtLogin: false },
    ...overrides,
  }
}

export function serviceStore(input: {
  providers?: Partial<Provider>[]
  channels?: Partial<Channel>[]
  key: string
}): Pick<Store, 'state' | 'decrypt'> {
  return {
    state: settings({
      providers: (input.providers || []).map((provider) => ({
        id: 'provider',
        name: '测试 AI',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-test',
        maxOutputTokens: 1500,
        ...provider,
      })),
      channels: (input.channels || []).map((channel) => ({
        id: 'phone',
        name: '测试手机',
        kind: 'sc3',
        ...channel,
      })),
    }),
    decrypt: () => input.key,
  }
}
