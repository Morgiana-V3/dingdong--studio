import { createInvoker } from './invoke.cjs'
import { _electron as electron } from '@playwright/test'
import { data, artifactPath, cleanup } from './environment.cjs'
import path from 'node:path'
import assert from 'node:assert/strict'
const root = path.resolve(__dirname, '../..')
async function main() {
  const application = await electron.launch({
    args: [path.join(root, 'tests/e2e/test-entry.cjs')],
    env: { ...process.env, MINIPUSH_TEST_DATA: data, MINIPUSH_SEED: '' },
  })
  try {
    const window = await application.firstWindow()
    await window.waitForSelector('#toolbar button')
    const errors = []
    window.on('pageerror', (error) => errors.push(error.message))
    const invoke = createInvoker(window)
    await window.screenshot({ path: artifactPath('empty.png') })
    await invoke('addExample')
    await invoke('saveChannel', { name: '测试手机', kind: 'sc3', key: 'sctp123ttest' })
    await invoke('saveProvider', {
      name: '共用 AI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
      maxOutputTokens: 500,
      key: 'test-key',
    })
    const state = await invoke('snapshot')
    for (let index = 0; index < 12; index++) {
      await invoke('saveTask', {
        name: index === 0 ? '很长的订阅任务名称'.repeat(10) : '订阅任务 ' + index,
        pluginId: state.plugins[0].id,
        channelId: state.channels[0].id,
        providerId: '',
        schedule: { type: 'manual' },
        enabled: true,
        onlyChanged: true,
        config: { title: '测试', body: '内容', useAI: false },
      })
    }
    await window.reload()
    await window.waitForSelector('.task-row')
    await window.setViewportSize({ width: 900, height: 620 })
    await window.mouse.move(850, 600)
    await window.screenshot({ path: artifactPath('minimum-tasks.png') })
    assert.equal(
      await window.evaluate(
        () =>
          document.querySelector('main')!.scrollWidth > document.querySelector('main')!.clientWidth,
      ),
      false,
    )
    await window.locator('.task-row').last().scrollIntoViewIfNeeded()
    await window
      .locator('.task-row')
      .first()
      .getByRole('button', { name: '编辑', exact: true })
      .click()
    await window.locator('[name="providerId"]').click()
    assert.equal(await window.evaluate(() => CSS.supports('appearance', 'base-select')), true)
    assert.equal(
      await window
        .locator('[name="providerId"]')
        .evaluate((element) => getComputedStyle(element, '::picker(select)').appearance),
      'base-select',
    )
    await window.screenshot({ path: artifactPath('custom-picker.png') })
    await window.keyboard.press('ArrowDown')
    await window.keyboard.press('Enter')
    assert.equal(await window.locator('[name="providerId"]').inputValue(), state.providers[0].id)
    await window.locator('[name="scheduleType"]').selectOption('interval')
    const minutes = window.locator('[name="minutes"]')
    await minutes.fill('60')
    await window.getByRole('button', { name: '增加间隔（分钟）', exact: true }).click()
    assert.equal(await minutes.inputValue(), '61')
    await window.getByRole('button', { name: '减少间隔（分钟）', exact: true }).click()
    assert.equal(await minutes.inputValue(), '60')
    await window.locator('[name="enabled"]').uncheck()
    assert.equal(await window.locator('[name="enabled"]').isChecked(), false)
    await window.locator('[name="enabled"]').check()
    await window.screenshot({ path: artifactPath('task-editor.png') })
    await window.getByRole('button', { name: '取消', exact: true }).click()
    await window.locator('[data-action="deleteTask"]').first().click()
    await window.getByRole('heading', { name: '删除此项？' }).waitFor()
    await window.getByRole('button', { name: '取消', exact: true }).click()
    assert.equal((await invoke('snapshot')).tasks.length, 12)
    assert.equal(await window.locator('svg').count(), 0)
    assert.equal(
      await window
        .locator('.nav-icon img')
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
      true,
    )
    for (const page of ['plugins', 'channels', 'providers', 'history', 'settings']) {
      await window.locator(`[data-page="${page}"]`).click()
      await window.mouse.move(850, 600)
      await window.screenshot({ path: artifactPath(`${page}.png`) })
      assert.equal(
        await window.evaluate(
          () =>
            document.querySelector('main')!.scrollWidth >
            document.querySelector('main')!.clientWidth,
        ),
        false,
      )
    }
    await window.locator('[data-page="providers"]').click()
    await window.locator('[data-action="editProvider"][data-id=""]').click()
    await window.screenshot({ path: artifactPath('ai-editor.png') })
    assert.equal(errors.length, 0)
    console.log(
      'PASS custom picker keyboard selection, number steppers, checkboxes, delete cancellation, PNG icons, all pages and minimum window',
    )
  } finally {
    await application.close()
  }
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(cleanup)
