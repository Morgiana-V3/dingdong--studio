export function enhanceNumbers(container: HTMLElement) {
  for (const input of container.querySelectorAll<HTMLInputElement>('input[type="number"]')) {
    if (input.parentElement!.classList.contains('number-control')) {
      continue
    }
    const label = input.closest('label')?.firstChild?.textContent?.trim() || '数值'
    const wrapper = document.createElement('span')
    wrapper.className = 'number-control'
    input.replaceWith(wrapper)
    wrapper.append(input)
    for (const direction of [-1, 1]) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = direction === 1 ? '+' : '−'
      button.setAttribute('aria-label', (direction === 1 ? '增加' : '减少') + label)
      button.onclick = (event) => {
        event.preventDefault()
        if (direction === 1) {
          input.stepUp()
        } else {
          input.stepDown()
        }
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }
      wrapper.append(button)
    }
  }
}
