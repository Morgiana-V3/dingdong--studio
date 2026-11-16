import type { Page } from '@playwright/test'
import type { Handlers } from '../../src/ipc.cjs'

export function createInvoker(page: Page) {
  return <K extends keyof Handlers>(action: K, ...payload: Parameters<Handlers[K]>) =>
    page.evaluate(
      ({ action, payload }) => {
        // The serialized browser boundary erases generics; the public wrapper retains them.
        const invoke = globalThis.window.miniPush.invoke as (
          action: keyof Handlers,
          ...payload: unknown[]
        ) => Promise<unknown>
        return invoke(action, ...payload)
      },
      { action, payload },
    ) as Promise<Awaited<ReturnType<Handlers[K]>>>
}
