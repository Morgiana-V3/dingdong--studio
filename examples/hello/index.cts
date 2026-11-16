import type { PluginContext } from '../../src/types.cjs'
export async function run(
  context: PluginContext<{ title: string; body: string; useAI?: boolean }, { executions?: number }>,
) {
  let body = context.config.body
  if (context.config.useAI) {
    body = await context.ai.generate(
      '请用简洁的中文 Markdown 润色以下内容，保留事实，只输出正文：\n\n' + body,
    )
  }
  return {
    message: { title: context.config.title, body },
    state: { executions: (context.state.executions || 0) + 1 },
  }
}
