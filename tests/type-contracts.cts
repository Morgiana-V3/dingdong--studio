import type { MiniPushAPI } from '../src/ipc.cjs'
import type { PluginContext, ToolRequest } from '../src/types.cjs'

// Compile-only checks: fail if the public contracts accidentally become untyped.
export function checkContracts(api: MiniPushAPI, context: PluginContext, request: ToolRequest) {
  void api.invoke('snapshot')
  void api.invoke('runTask', 'task-id')
  void context.sources.tieba.post({ id: '123' })
  void context.ai.respond(request)

  // @ts-expect-error An unknown IPC action must not compile.
  void api.invoke('unknownAction')
  // @ts-expect-error Task identifiers are strings.
  void api.invoke('runTask', 123)
  // @ts-expect-error Source calls require their declared parameters.
  void context.sources.tieba.post({ url: 'https://example.com' })
  // @ts-expect-error AI tool requests require instructions, input, and tools.
  void context.ai.respond({ prompt: 'untyped' })
}
