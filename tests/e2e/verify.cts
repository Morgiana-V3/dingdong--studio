import { createInvoker } from './invoke.cjs'
import { _electron as electron } from '@playwright/test'
import path from 'node:path'
import { data, artifactPath, cleanup } from './environment.cjs'
import assert from 'node:assert/strict'
const root = path.resolve(__dirname, '../..')

async function main() {
  const application = await electron.launch({
    args: [path.join(root, 'tests/e2e/test-entry.cjs')],
    env: { ...process.env, MINIPUSH_TEST_DATA: data, MINIPUSH_SEED: '' },
  })
  try {
    const window = await application.firstWindow()
    await window.waitForSelector('[data-action="editTask"]')
    const errors = []
    window.on('pageerror', (error) => errors.push(error.message))
    const invoke = createInvoker(window)
    await window.getByRole('button', { name: '插件', exact: true }).click()
    await window.getByRole('button', { name: '安装示例', exact: true }).click()
    await window.getByText('自定义消息', { exact: true }).waitFor()
    await window.getByRole('button', { name: '推送渠道', exact: true }).click()
    await window.locator('#toolbar [data-action="editChannel"]').click()
    await window.locator('[name="name"]').fill('测试手机')
    await window.locator('[name="kind"]').selectOption('sc3')
    await window.locator('[name="key"]').fill('sctp123ttest')
    await window.getByRole('button', { name: '保存', exact: true }).click()
    await window.getByText('测试手机', { exact: true }).waitFor()
    await invoke('saveProvider', {
      name: '测试 AI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
      maxOutputTokens: 500,
      key: 'test-key',
    })
    await window.reload()
    await window.getByRole('button', { name: '任务', exact: true }).click()
    await window.locator('#toolbar [data-action="editTask"]').click()
    await window.locator('[name="name"]').fill('每日测试消息')
    await window.locator('[name="providerId"]').selectOption({ label: '测试 AI' })
    await window.locator('[name="plugin.useAI"]').check()
    await window.getByRole('button', { name: '保存', exact: true }).click()
    await window.getByRole('button', { name: '立即执行' }).click()
    await window.getByText('测试接收器已接受消息', { exact: true }).waitFor()
    let state = await invoke('snapshot')
    assert.equal(state.history[0].status, 'sent')
    assert.equal(state.history[0].message!.body, 'AI 统一接口测试成功')
    assert.equal(state.providers[0].secret, undefined)
    assert.equal(state.channels[0].secret, undefined)
    const second = await invoke('runTask', state.tasks[0].id)
    assert.equal(second.status, 'skipped')
    await window.getByRole('button', { name: '运行记录', exact: true }).click()
    await window.locator('[data-action="viewRecord"]').first().click()
    await window.getByRole('button', { name: '关闭', exact: true }).click()
    await window.getByRole('button', { name: '任务', exact: true }).click()
    await window.screenshot({ path: artifactPath('tasks.png') })
    await window.setViewportSize({ width: 900, height: 620 })
    assert.equal(await window.evaluate(() => document.body.scrollWidth > innerWidth), false)
    await window.getByRole('button', { name: '编辑', exact: true }).click()
    await window.locator('[name="scheduleType"]').selectOption('daily')
    await window.locator('.daily-time').fill('04:00')
    assert.equal(await window.locator('.time-remove').isDisabled(), true)
    await window.locator('.time-add').click()
    await window.locator('.daily-time').nth(1).fill('12:00')
    await window.locator('.time-add').click()
    await window.locator('.daily-time').nth(2).fill('20:00')
    await window.locator('[name="scheduleType"]').selectOption('interval')
    await window.locator('[name="minutes"]').fill('45')
    await window.locator('[name="scheduleType"]').selectOption('daily')
    assert.deepEqual(
      await window
        .locator('.daily-time')
        .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)),
      ['04:00', '12:00', '20:00'],
    )
    await window.locator('.time-remove').nth(1).click()
    await window.locator('.time-add').click()
    await window.locator('.daily-time').last().fill('12:00')
    await window.locator('#schedule-detail').scrollIntoViewIfNeeded()
    await window.screenshot({ path: artifactPath('multiple-daily-times.png') })
    await window.getByRole('button', { name: '保存', exact: true }).click()
    state = await invoke('snapshot')
    assert.ok(state.tasks[0].nextRun! > Date.now())
    assert.deepEqual(state.tasks[0].schedule, { type: 'daily', times: ['04:00', '12:00', '20:00'] })
    await window.getByRole('button', { name: '编辑', exact: true }).click()
    assert.deepEqual(
      await window
        .locator('.daily-time')
        .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)),
      ['04:00', '12:00', '20:00'],
    )
    await window.getByRole('button', { name: '取消', exact: true }).click()
    await invoke('toggleTask', state.tasks[0].id)
    state = await invoke('snapshot')
    assert.equal(state.tasks[0].nextRun, null)
    assert.equal(errors.length, 0)
    console.log(
      'PASS UI forms, plugin child process, AI bridge, dedup, history, schedule, pause, minimum window',
    )
  } finally {
    await application.close()
  }
  const restarted = await electron.launch({
    args: [path.join(root, 'tests/e2e/test-entry.cjs')],
    env: { ...process.env, MINIPUSH_TEST_DATA: data, MINIPUSH_SEED: '' },
  })
  try {
    const window = await restarted.firstWindow()
    await window.waitForSelector('[data-action="editTask"]')
    const state = await window.evaluate(() => globalThis.window.miniPush.invoke('snapshot'))
    assert.equal(state.tasks[0].name, '每日测试消息')
    assert.deepEqual(state.tasks[0].schedule.times, ['04:00', '12:00', '20:00'])
    assert.equal(state.history.length, 2)
    assert.equal(state.channels[0].hasKey, true)
    console.log('PASS persistence across restart')
  } finally {
    await restarted.close()
  }
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(cleanup)
