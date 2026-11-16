import { createInvoker } from './invoke.cjs'
import { _electron as electron } from '@playwright/test'
import path from 'node:path'
import { data, artifactPath, cleanup } from './environment.cjs'
import assert from 'node:assert/strict'
const root = path.resolve(__dirname, '../..')
async function main() {
  const application = await electron.launch({
    args: [path.join(root, 'tests/e2e/test-entry.cjs')],
    env: {
      ...process.env,
      MINIPUSH_TEST_DATA: data,
      MINIPUSH_SEED: '',
      MINIPUSH_TIEBA_TEST: '1',
    },
  })
  try {
    const window = await application.firstWindow()
    await window.route('https://tiebapic.baidu.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
          'base64',
        ),
      }),
    )
    await window.waitForSelector('#toolbar button')
    const invoke = createInvoker(window)
    await invoke('saveChannel', { name: '测试手机', kind: 'sc3', key: 'sctp123ttest' })
    await invoke('saveProvider', {
      name: '测试 AI',
      baseUrl: 'https://api.openai.com/v1',
      key: 'fixture-key',
      model: 'gpt-test',
      maxOutputTokens: 1500,
    })
    await window.reload()
    await window.locator('[data-page="plugins"]').click()
    await window.getByRole('button', { name: '安装贴吧插件', exact: true }).click()
    await window.getByRole('button', { name: '配置贴吧订阅', exact: true }).click()
    await window.locator('#tieba-filter').click()
    await window
      .getByText('请填写各贴吧名称、可用的过滤说明，并选择 AI 配置', { exact: true })
      .waitFor()
    await window.locator('.forum-name').first().fill('失败')
    await window.locator('#tieba-preview').click()
    await window.getByText('贴吧连接失败或超时', { exact: true }).waitFor()
    await window.locator('.forum-name').first().fill('bilibili')
    await window.locator('#tieba-global').fill('梗文化、漫画讨论、动画讨论')
    assert.equal(await window.locator('.forum-remove').isDisabled(), true)
    await window.locator('.forum-add').click()
    await window.locator('.forum-name').nth(1).fill('macmini')
    await window.locator('.forum-filter').nth(1).fill('本吧关注硬件评测，排除交易')
    assert.equal(await window.locator('.forum-name').first().inputValue(), 'bilibili')
    const snapshot = await invoke('snapshot')
    await window.locator('#tieba-provider').selectOption(snapshot.providers[0].id)
    await window.locator('#tieba-preview').click()
    await window.getByText('二手电脑出售', { exact: true }).first().waitFor()
    await window.locator('#tieba-filter').click()
    await window.getByText('楼主首楼的原始表达，不是 AI 摘要。', { exact: true }).first().waitFor()
    await window.getByText('硬件散热评测', { exact: true }).waitFor()
    assert.equal(await window.getByText('二手电脑出售', { exact: true }).count(), 0)
    assert.equal((await invoke('snapshot')).tasks.length, 0)
    await window.locator('#tieba-trace summary').click()
    await window.getByText('回帖数 > 20；2 条 → 1 条', { exact: true }).first().waitFor()
    await window.locator('#tieba-trace').scrollIntoViewIfNeeded()
    await window.screenshot({ path: artifactPath('tieba-original-preview.png') })
    await window.setViewportSize({ width: 900, height: 620 })
    await window.screenshot({ path: artifactPath('tieba-interest-ui.png') })
    await window.getByRole('button', { name: '配置精选任务', exact: true }).click()
    assert.equal(
      await window.locator('[name="plugin.globalFilter"]').inputValue(),
      '梗文化、漫画讨论、动画讨论',
    )
    assert.equal(await window.locator('[name="plugin.useAI"]').count(), 0)
    assert.equal(await window.locator('[name="providerId"]').inputValue(), snapshot.providers[0].id)
    await window.locator('[name="scheduleType"]').selectOption('manual')
    await window.getByRole('button', { name: '保存', exact: true }).click()
    await window.locator('#editor').waitFor({ state: 'hidden' })
    let task = (await invoke('snapshot')).tasks[0]
    assert.deepEqual(task.config.forums, [
      { name: 'bilibili', filter: '' },
      { name: 'macmini', filter: '本吧关注硬件评测，排除交易' },
    ])
    await window.locator('[data-page="tasks"]').click()
    await window.locator(`[data-action="editTask"][data-id="${task.id}"]`).click()
    await window.locator('.forum-remove').nth(1).click()
    assert.equal(await window.locator('.forum-name').count(), 1)
    assert.equal(await window.locator('.forum-name').inputValue(), 'bilibili')
    await window.locator('.forum-add').click()
    await window.locator('.forum-name').nth(1).fill('macmini')
    await window.locator('.forum-filter').nth(1).fill('只关注硬件拆解和评测')
    for (let i = 0; i < 3; i++) {
      await window.locator('.forum-add').click()
    }
    assert.equal(await window.locator('.forum-add').isDisabled(), true)
    for (let i = 0; i < 3; i++) {
      await window.locator('.forum-remove').last().click()
    }
    await window.locator('#dialog-content').evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    assert.equal(await window.evaluate(() => document.body.scrollWidth > innerWidth), false)
    await window.screenshot({ path: artifactPath('tieba-multi-edit.png') })
    await window.getByRole('button', { name: '保存', exact: true }).click()
    await window.locator('#editor').waitFor({ state: 'hidden' })
    task = (await invoke('snapshot')).tasks[0]
    assert.ok(Array.isArray(task.config.forums))
    assert.equal(task.config.forums[1].filter, '只关注硬件拆解和评测')
    const result = await invoke('runTask', task.id)
    assert.equal(result.status, 'sent')
    assert.ok(result.trace)
    assert.ok(result.message)
    assert(result.trace.some((entry) => entry.tool === 'read_posts'))
    assert(result.trace.some((entry) => entry.detail.includes('回帖数 > 20')))
    assert.doesNotMatch(result.message.body, /符合动画讨论兴趣|为什么推荐|网页备用|为你精选/)
    assert.match(result.message.body, /楼主首楼的原始表达/)
    assert.equal(result.message.title, task.name)
    assert.match(result.message.body, /^## \[/)
    assert.match(result.message.body, /\n\n---\n\n/)
    assert.doesNotMatch(result.message.body, /测试楼主/)
    assert.match(result.message.body, /> macmini吧/)
    assert.match(result.message.body, /> bilibili吧/)
    assert.match(result.message.body, /com\.baidu\.tieba:/)
    assert.equal((await invoke('runTask', task.id)).status, 'skipped')
    const invalid = { ...task, providerId: '' }
    await assert.rejects(invoke('saveTask', invalid), /兴趣筛选/)
    await window.locator('button[data-page="history"]').click()
    await window.locator(`[data-action="viewRecord"][data-id="${result.id}"]`).click()
    await window.locator('.tool-trace summary').click()
    await window.getByText('回帖数 > 20；2 条 → 1 条', { exact: true }).first().waitFor()
    await window.screenshot({ path: artifactPath('tieba-agent-history.png') })
    await window.getByRole('button', { name: '关闭', exact: true }).click()
    console.log(
      'PASS multi-forum wizard and edit persistence, add/remove limits, global/local rules, candidate and AI preview, no preview delivery, worker bridges, linked post titles and dedup',
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
