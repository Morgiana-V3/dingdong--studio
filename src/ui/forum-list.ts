import type { Escape } from './dom.js'
import type { Forum } from '../types.cjs'
import { query as getElement } from './dom.js'
export function forumListHTML(value: unknown, escape: Escape) {
  const forums = Array.isArray(value) && value.length ? value : [{ name: '', filter: '' }]
  return `<div class="forum-list"><p class="help">各贴吧单独筛选。未填写单独说明时沿用总规则；发生冲突时本吧规则优先，未冲突的总规则继续生效。</p><div class="forum-cards">${forums.map((forum, index) => card(forum, index, escape)).join('')}</div><button type="button" class="forum-add">＋ 添加贴吧</button><span class="help forum-limit"></span></div>`
}
function card(forum: Partial<Forum>, index: number, escape: Escape) {
  return `<section class="forum-card"><div class="forum-heading"><strong>贴吧配置 <span class="forum-index">${index + 1}</span></strong><button type="button" class="small danger forum-remove">移除此贴吧</button></div><label>贴吧名<input class="forum-name" value="${escape(forum.name || '')}" placeholder="例如 bilibili" maxlength="60" required></label><label>本吧过滤说明<textarea class="forum-filter" rows="3" maxlength="3000" placeholder="留空沿用总规则；填写本吧关注、排除或例外要求">${escape(forum.filter || '')}</textarea></label></section>`
}
export function bindForumLists(container: HTMLElement, escape: Escape) {
  for (const list of container.querySelectorAll<HTMLElement>('.forum-list')) {
    if (list.dataset.bound) {
      continue
    }
    list.dataset.bound = 'true'
    const cards = getElement<HTMLElement>(list, '.forum-cards')
    function update() {
      const rows = [...cards.children]
      rows.forEach((row, index) => {
        getElement<HTMLElement>(row, '.forum-index').textContent = String(index + 1)
        getElement<HTMLButtonElement>(row, '.forum-remove').disabled = rows.length === 1
      })
      getElement<HTMLButtonElement>(list, '.forum-add').disabled = rows.length >= 5
      getElement<HTMLElement>(list, '.forum-limit').textContent = `已配置 ${rows.length} / 5 个贴吧`
    }
    list.addEventListener('click', (event) => {
      const add = (event.target as HTMLElement).closest('.forum-add')
      const remove = (event.target as HTMLElement).closest('.forum-remove')
      if (add && cards.children.length < 5) {
        cards.insertAdjacentHTML('beforeend', card({}, cards.children.length, escape))
        update()
        getElement<HTMLInputElement>(cards.lastElementChild!, 'input').focus()
      } else if (remove && cards.children.length > 1) {
        remove.closest('.forum-card')?.remove()
        update()
      }
    })
    update()
  }
}
export function readForumList(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('.forum-card')].map((card) => ({
    name: getElement<HTMLInputElement>(card, '.forum-name').value.trim(),
    filter: getElement<HTMLTextAreaElement>(card, '.forum-filter').value.trim(),
  }))
}
