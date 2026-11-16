import { createInvoker } from './invoke.cjs'
import { _electron as electron } from '@playwright/test'
import path from 'node:path'
import { data, artifactPath, cleanup } from './environment.cjs'
import assert from 'node:assert/strict'
const root = path.resolve(__dirname, '../..')
async function main() {
  const application = await electron.launch({
    args: [path.join(root, 'tests/e2e/test-entry.cjs')],
    env: { ...process.env, MINIPUSH_TEST_DATA: data, MINIPUSH_SEED: '', MINIPUSH_X_TEST: '1' },
  })
  try {
    const window = await application.firstWindow()
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
    await window.locator('button[data-page="plugins"]').click()
    await window.getByRole('button', { name: '安装 X 插件', exact: true }).click()
    await window.getByRole('button', { name: '登录与兴趣发现', exact: true }).click()
    await window.getByText('尚未登录 X', { exact: true }).waitFor()
    await window.locator('#x-preview').click()
    await window.getByText('请先登录 X 并刷新登录状态', { exact: true }).waitFor()
    await window.locator('#x-login').click()
    await window.locator('#x-refresh').click()
    await window.getByText('已保存 X 登录 · 账号 100', { exact: true }).waitFor()
    await window.locator('#x-interests').fill('寻找开源模型和实用工具，回复数超过 20，排除广告')
    const snapshot = await invoke('snapshot')
    await window.locator('#x-provider').selectOption(snapshot.providers[0].id)
    await window.getByText('测试关键词搜索', { exact: true }).click()
    await window.locator('#x-query').fill('失败')
    await window.locator('#x-search').click()
    await window.getByText('X 搜索限流', { exact: true }).waitFor()
    await window.locator('#x-query').fill('OpenAI')
    await window.locator('#x-search').click()
    await window.getByText('不符合互动条件', { exact: true }).waitFor()
    await window.locator('#x-preview').click()
    await window
      .getByText('候选 2 条，入选 1 条。以下为原文节选，尚未发送。', { exact: true })
      .waitFor()
    assert.equal(await window.getByText('不符合互动条件', { exact: true }).count(), 0)
    const afterPreview = await invoke('snapshot')
    assert.equal(afterPreview.tasks.length, 0)
    assert.equal(afterPreview.history.length, 0)
    await window.locator('#x-trace summary').click()
    await window.getByText('读取 X 原帖', { exact: true }).waitFor()
    await window.locator('#x-posts').scrollIntoViewIfNeeded()
    await window.screenshot({ path: artifactPath('x-preview.png') })
    await window.locator('#x-create').click()
    assert.equal(await window.locator('[name="plugin.accountId"]').inputValue(), '100')
    assert.equal(await window.locator('[name="providerId"]').inputValue(), snapshot.providers[0].id)
    await window.locator('[name="scheduleType"]').selectOption('manual')
    await window.getByRole('button', { name: '保存', exact: true }).click()
    await window.locator('#editor').waitFor({ state: 'hidden' })
    const task = (await invoke('snapshot')).tasks[0]
    const result = await invoke('runTask', task.id)
    assert.equal(result.status, 'sent')
    assert.equal(result.message?.title, task.name)
    assert.match(result.message!.body, /https:\/\/x.com\/fixture\/status\/12345/)
    assert.match(result.message!.body, /开源模型发布/)
    assert.ok(result.trace?.some((item) => item.tool === 'search_posts'))
    assert.ok(result.trace?.some((item) => item.tool === 'read_x_posts'))
    assert.equal((await invoke('runTask', task.id)).status, 'skipped')
    await assert.rejects(invoke('saveTask', { ...task, providerId: '' }), /兴趣筛选/)
    await invoke('xLogout')
    assert.equal((await invoke('runTask', task.id)).status, 'failed')
    await window.locator('button[data-page="plugins"]').click()
    await window.getByRole('button', { name: '登录与兴趣发现', exact: true }).click()
    await window.getByText('尚未登录 X', { exact: true }).waitFor()
    await window.locator('#x-import').click()
    await window.locator('#x-refresh').click()
    await window.getByText('已保存 X 登录 · 账号 100', { exact: true }).waitFor()
    await window.setViewportSize({ width: 900, height: 620 })
    assert.equal(await window.evaluate(() => document.body.scrollWidth > innerWidth), false)
    await window.screenshot({ path: artifactPath('x-compact.png') })
    console.log(
      'PASS X login, search failure, candidate and AI preview without delivery, task configuration, worker source/AI bridge, original text formatting, dedup and logout failure',
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
