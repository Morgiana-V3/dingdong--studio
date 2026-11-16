import type { MiniPushAPI } from '../ipc.cjs'
import type { Provider, TaskDraft } from '../types.cjs'

export type Escape = (value?: unknown) => string
export type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
export interface PanelOptions {
  dialog: HTMLDialogElement
  content: HTMLElement
  api: MiniPushAPI
  escape: Escape
  providers?: Provider[]
  onCreate(draft: TaskDraft): void
}

export function query<E extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): E {
  const element = root.querySelector<E>(selector)
  if (!element) {
    throw new Error(`找不到界面元素：${selector}`)
  }
  return element
}

export function control(form: HTMLFormElement, name: string): Control {
  const element = form.elements.namedItem(name)
  if (!(
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  )) {
    throw new Error(`找不到表单字段：${name}`)
  }
  return element
}

export function checked(form: HTMLFormElement, name: string): boolean {
  const element = control(form, name)
  return element instanceof HTMLInputElement && element.checked
}

export function values(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, String(value)]))
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
