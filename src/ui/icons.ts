const objectIcons = new Set(['tasks', 'plugins', 'channels', 'providers', 'history', 'settings'])

export function icon(name = '') {
  if (objectIcons.has(name)) {
    return `<img class="icon object-icon" src="assets/icons/${name}.png" alt="" aria-hidden="true">`
  }
  const symbols: Record<string, string> = { plus: '+', play: '▶', check: '✓' }
  return `<span class="icon symbol-icon" aria-hidden="true">${symbols[name] || '+'}</span>`
}
