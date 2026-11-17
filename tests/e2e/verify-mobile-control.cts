import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { _electron } from 'playwright-core'
import { data, cleanup } from './environment.cjs'
import { createInvoker } from './invoke.cjs'
import type { MobileCommand, mobileSnapshot } from '../../src/mobile-control.cjs'

async function main() {
  const key = 'fictional-mobile-control-send-token-123456789'
  let latest: { session: string; snapshot: ReturnType<typeof mobileSnapshot> } | undefined
  let commands: MobileCommand[] = []
  const results = new Map<string, { ok: boolean; error?: string }>()
  const server = http.createServer(async (request, response) => {
    assert.equal(request.url, '/v1/studio/sync')
    assert.equal(request.headers.authorization, `Bearer ${key}`)
    let body = ''
    for await (const chunk of request) body += chunk
    const value = JSON.parse(body)
    latest = value
    for (const result of value.results) results.set(result.id, result)
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ commands }))
    commands = []
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as import('node:net').AddressInfo).port
  const application = await _electron.launch({
    args: [path.join(__dirname, 'test-entry.cjs')],
    env: { ...process.env, MINIPUSH_TEST_DATA: data, MINIPUSH_SEED: '' },
  })
  async function waitFor(check: () => boolean) {
    for (let count = 0; count < 150; count++) {
      if (check()) return
      await delay(100)
    }
    throw new Error('Studio control confirmation timed out')
  }
  let sequence = 0
  async function send(action: string, payload: Record<string, unknown>, revision?: string) {
    assert.ok(latest)
    const id = String(++sequence)
    commands.push({
      id,
      session: latest.session,
      revision: revision || latest.snapshot.revision,
      action,
      payload,
      ttlMs: 20000,
    })
    await waitFor(() => results.has(id))
    return results.get(id)!
  }
  try {
    const page = await application.firstWindow()
    await page.waitForSelector('#toolbar button')
    const invoke = createInvoker(page)
    await invoke('installBilibili')
    await invoke('saveChannel', {
      name: '测试手机',
      kind: 'dingdong',
      baseUrl: `http://127.0.0.1:${port}`,
      key,
    })
    const channelId = (await invoke('snapshot')).channels[0].id
    await page.reload()
    await page.locator('[data-page=settings]').click()
    assert.equal(await page.locator('#mobile-channel').inputValue(), '')
    await page.locator('#mobile-channel').selectOption(channelId)
    await waitFor(() => Boolean(latest))
    assert.doesNotMatch(JSON.stringify(latest), /fictional-mobile|secret|location|history/)
    const created = await send('saveTask', {
      name: '手机创建的订阅',
      pluginId: 'bilibili-videos',
      channelId,
      providerId: '',
      schedule: { type: 'manual' },
      enabled: false,
      onlyChanged: true,
      config: { accountMid: '100', upIds: '200', keywords: '编程', useAI: false, maxItems: 5 },
    })
    assert.equal(created.ok, true)
    const task = (await invoke('snapshot')).tasks[0]
    assert.equal(task.name, '手机创建的订阅')
    const before = latest!.snapshot.revision
    const edited = await send('saveTask', {
      ...task,
      name: '手机修改的订阅',
      schedule: { type: 'daily', times: ['08:00', '20:00'] },
      config: { ...task.config, keywords: '开源' },
    })
    assert.equal(edited.ok, true)
    let state = await invoke('snapshot')
    assert.deepEqual(state.tasks[0].schedule, { type: 'daily', times: ['08:00', '20:00'] })
    assert.equal(state.tasks[0].config.keywords, '开源')
    assert.equal((await send('setEnabled', { id: task.id, enabled: true }, before)).ok, false)
    assert.equal((await send('setEnabled', { id: task.id, enabled: true })).ok, true)
    state = await invoke('snapshot')
    assert.equal(state.tasks[0].enabled, true)
    assert.ok(state.tasks[0].nextRun)
    assert.equal((await send('deleteTask', { id: task.id })).ok, true)
    assert.equal((await invoke('snapshot')).tasks.length, 0)
    await page.locator('#mobile-channel').selectOption('')
    await page.waitForFunction(() =>
      window.miniPush.invoke('snapshot').then((state) => state.preferences.mobileChannelId === ''),
    )
    assert.equal((await invoke('snapshot')).preferences.mobileChannelId, '')
    console.log(
      'PASS mobile opt-in, remote create/edit/schedule/enable/delete, revision conflict, credential projection',
    )
  } finally {
    await application.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(cleanup)
