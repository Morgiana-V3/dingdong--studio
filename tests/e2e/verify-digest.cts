import assert from 'node:assert/strict'
import path from 'node:path'
import { _electron } from 'playwright-core'
import { data, artifactPath, cleanup } from './environment.cjs'
import { createInvoker } from './invoke.cjs'

async function main() {
  const application = await _electron.launch({
    args: [path.join(__dirname, 'test-entry.cjs')],
    env: {
      ...process.env,
      MINIPUSH_TEST_DATA: data,
      MINIPUSH_SEED: '',
      MINIPUSH_DIGEST_FAILURE_TEST: '1',
    },
  })
  try {
    const page = await application.firstWindow()
    await page.waitForSelector('#toolbar button')
    const invoke = createInvoker(page)
    await invoke('addExample')
    await invoke('saveChannel', {
      name: '测试手机',
      kind: 'dingdong',
      baseUrl: 'http://127.0.0.1:8080',
      key: 'fictional-test-send-token-'.repeat(3),
    })
    const channelId = (await invoke('snapshot')).channels[0].id
    for (const name of ['动画订阅', '科技订阅']) {
      await invoke('saveTask', {
        name,
        pluginId: 'hello-message',
        channelId,
        providerId: '',
        enabled: true,
        onlyChanged: true,
        schedule: { type: 'interval', minutes: 30 },
        config: { title: name, body: name + '的原文', useAI: false },
      })
    }
    await page.reload()
    await page.locator('#toolbar [data-action=createDigest]').click()
    assert.equal(await page.locator('[data-source-task]:checked').count(), 2)
    assert.equal(await page.locator('[name=minutes]').inputValue(), '60')
    assert.equal(await page.locator('#provider-field').isHidden(), true)
    await page.locator('[data-source-task]').last().uncheck()
    await page.locator('[data-source-task]').last().check()
    await page.screenshot({ path: artifactPath('digest-settings.png') })
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.locator('#editor').waitFor({ state: 'hidden' })
    let state = await invoke('snapshot')
    const digest = state.tasks.find((task) => task.pluginId === 'minipush-digest')!
    const sources = state.tasks.filter((task) => task.id !== digest.id)
    assert.ok(sources.every((task) => !task.enabled && task.nextRun === null))
    assert.ok(sources.every((task) => task.schedule.minutes === 30))
    assert.equal(await page.getByText('汇总内容源', { exact: true }).count(), 2)
    await assert.rejects(invoke('toggleTask', sources[0].id), /统一推送/)
    await assert.rejects(invoke('deleteTask', sources[0].id), /汇总任务/)
    await assert.rejects(invoke('runTask', sources[0].id), /统一推送/)
    const record = await invoke('runTask', digest.id)
    assert.equal(record.status, 'sent')
    assert.equal(record.message?.sections?.length, 2)
    state = await invoke('snapshot')
    assert.equal(state.history.length, 1)
    const previewPromise = application.waitForEvent('window')
    await invoke('previewDelivery', record.id)
    const preview = await previewPromise
    await preview.waitForSelector('main > article')
    assert.equal(await preview.locator('main > article').count(), 2)
    await preview.screenshot({ path: artifactPath('digest-document.png') })
    await preview.close()
    assert.equal((await invoke('runTask', digest.id)).status, 'skipped')
    await page.reload()
    await page.locator(`[data-action=editTask][data-id="${digest.id}"]`).click()
    assert.equal(await page.locator('[data-source-task]:checked').count(), 2)
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await invoke('saveTask', {
      ...sources[0],
      config: { ...sources[0].config, body: '模拟来源失败' },
    })
    await invoke('saveTask', {
      ...sources[1],
      config: { ...sources[1].config, body: '正常来源的新内容' },
    })
    const partial = await invoke('runTask', digest.id)
    assert.equal(partial.status, 'partial')
    assert.equal(partial.sourceFailures?.length, 1)
    assert.equal(partial.message?.sections?.length, 1)
    assert.equal(partial.message?.sections?.[0].name, sources[1].name)
    await page.locator('[data-page=history]').click()
    await page.locator(`[data-action=viewRecord][data-id="${partial.id}"]`).click()
    assert.equal(
      await page.locator('.source-failures').textContent(),
      sources[0].name + '：测试来源暂时不可用',
    )
    await page.screenshot({ path: artifactPath('digest-partial.png') })
    await page.locator('[data-close]').click()
    await invoke('toggleTask', digest.id)
    await invoke('toggleTask', sources[0].id)
    assert.equal(
      (await invoke('snapshot')).tasks.find((task) => task.id === sources[0].id)!.enabled,
      true,
    )
    console.log(
      'PASS unified source selection, hourly schedule, source ownership, one delivery, dedup, preview and reversible scheduling',
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
