import type { Escape } from './dom.js'
import { query as getElement } from './dom.js'
export function readTimes(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLInputElement>('.daily-time')].map((input) =>
    input.value.trim(),
  )
}
function row(time: string, escape: Escape) {
  return `<div class="daily-time-row"><input class="daily-time" name="time" value="${escape(time)}" aria-label="执行时间" required inputmode="numeric" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" placeholder="04:00" title="请输入 24 小时制时间，例如 04:00" maxlength="5"><button type="button" class="small danger time-remove">移除</button></div>`
}
export function timesHTML(times: string[], escape: Escape) {
  return `<div class="daily-times"><p class="help">每天按北京时间执行，可添加多个时间点。</p><div class="time-rows">${times.map((time) => row(time, escape)).join('')}</div><button type="button" class="time-add">＋ 添加时间点</button><span class="help time-count"></span></div>`
}
export function bindTimes(container: HTMLElement, escape: Escape) {
  const list = container.querySelector<HTMLElement>('.daily-times')
  if (!list) {
    return
  }
  const rows = getElement<HTMLElement>(list!, '.time-rows')
  function update() {
    for (const button of rows.querySelectorAll<HTMLButtonElement>('.time-remove')) {
      button.disabled = rows.children.length === 1
    }
    getElement<HTMLButtonElement>(list!, '.time-add').disabled = rows.children.length >= 24
    getElement<HTMLElement>(list!, '.time-count').textContent =
      `已配置 ${rows.children.length} 个时间点，最多 24 个`
  }
  list.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('.time-add') && rows.children.length < 24) {
      rows.insertAdjacentHTML('beforeend', row('', escape))
      update()
      getElement<HTMLInputElement>(rows.lastElementChild!, 'input').focus()
    } else if ((event.target as HTMLElement).closest('.time-remove') && rows.children.length > 1) {
      ;(event.target as HTMLElement).closest('.daily-time-row')?.remove()
      update()
    }
  })
  update()
}
