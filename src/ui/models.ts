import type { MiniPushAPI } from '../ipc.cjs'
import { query as getElement, control, errorMessage } from './dom.js'
export function setupModelPicker(form: HTMLFormElement, api: MiniPushAPI, providerId?: string) {
  const host = getElement<HTMLElement>(form, '#model-control')
  const fetchButton = getElement<HTMLButtonElement>(form, '#fetch-models')
  const toggle = getElement<HTMLButtonElement>(form, '#manual-model')
  const search = getElement<HTMLInputElement>(form, '#model-search')
  const status = getElement<HTMLElement>(form, '#model-status')
  let models: string[] = []
  let manual = false
  let revision = 0

  function renderOptions() {
    const selected = control(form, 'model').value
    const query = search.value.trim().toLowerCase()
    const visible = models.filter((model) => model.toLowerCase().includes(query))
    const select = document.createElement('select')
    select.name = 'model'
    select.required = true
    select.setAttribute('aria-label', '模型')
    if (selected && !visible.includes(selected)) {
      select.add(new Option(selected + '（当前选择）', selected))
    }
    for (const model of visible) {
      select.add(new Option(model, model))
    }
    select.value = selected
    if (!selected) {
      select.selectedIndex = 0
    }
    host.replaceChildren(select)
    status.textContent = `已获取 ${models.length} 个模型，筛选匹配 ${visible.length} 个。`
  }

  function clearList() {
    revision += 1
    models = []
    search.value = ''
    search.parentElement!.hidden = true
    status.textContent = '连接信息已更改，请重新获取模型列表。'
    if (!manual) {
      renderOptions()
      status.textContent = '连接信息已更改，请重新获取模型列表。'
    }
  }
  control(form, 'baseUrl').addEventListener('input', clearList)
  control(form, 'key').addEventListener('input', clearList)
  search.addEventListener('input', renderOptions)

  toggle.onclick = () => {
    const value = control(form, 'model').value
    manual = !manual
    toggle.textContent = manual ? '从列表选择' : '手动填写'
    search.parentElement!.hidden = manual || !models.length
    if (manual) {
      const input = document.createElement('input')
      input.name = 'model'
      input.value = value
      input.required = true
      input.setAttribute('aria-label', '模型')
      host.replaceChildren(input)
      input.focus()
    } else {
      renderOptions()
    }
  }

  fetchButton.onclick = async () => {
    const requestRevision = ++revision
    fetchButton.disabled = true
    fetchButton.textContent = '正在获取…'
    status.textContent = '正在读取模型列表…'
    try {
      const fetched = await api.invoke('listModels', {
        id: providerId,
        baseUrl: control(form, 'baseUrl').value,
        key: control(form, 'key').value,
      })
      if (!form.isConnected || revision !== requestRevision) {
        return
      }
      models = fetched
      manual = false
      toggle.textContent = '手动填写'
      search.parentElement!.hidden = false
      search.value = ''
      renderOptions()
    } catch (error) {
      if (form.isConnected && revision === requestRevision) {
        status.textContent = errorMessage(error)
      }
    } finally {
      fetchButton.disabled = false
      fetchButton.textContent = '获取模型列表'
    }
  }
}
