import { createInvoker } from './invoke.cjs'
import { _electron as electron } from '@playwright/test'
import path from 'node:path'
import { data, artifactPath, cleanup } from './environment.cjs'
import assert from 'node:assert/strict'
const root = path.resolve(__dirname, '../..')
async function main() {
  const application = await electron.launch({
    args: [path.join(root, 'tests/e2e/test-entry.cjs')],
    env: { ...process.env, MINIPUSH_TEST_DATA: data, MINIPUSH_SEED: '', MINIPUSH_XHS_TEST: '1' },
  })
  try {
    const window = await application.firstWindow()
    await window.waitForSelector('#toolbar button')
    const invoke = createInvoker(window)
    await invoke('saveChannel', {
      name: '测试叮咚',
      kind: 'dingdong',
      baseUrl: 'https://example.test',
      key: 'fixture-send-token-for-e2e-tests-1234567890',
    })
    await invoke('saveProvider', {
      name: '测试 AI',
      baseUrl: 'https://api.openai.com/v1',
      key: 'fixture-key',
      model: 'gpt-test',
      maxOutputTokens: 1500,
    })
    await window.reload()
    await window.locator('button[data-page="plugins"]').click()
    await window.getByRole('button', { name: '安装小红书插件', exact: true }).click()
    await window.getByRole('button', { name: '登录与兴趣发现', exact: true }).click()
    await window.getByText('尚未登录小红书', { exact: true }).waitFor()
    await window.locator('#xhs-preview').click()
    await window.getByText('请先登录小红书并刷新状态', { exact: true }).waitFor()
    await window.locator('#xhs-login').click()
    await window.locator('#xhs-refresh').click()
    await window.getByText('已登录 · 测试小红书账号', { exact: true }).waitFor()
    const snapshot = await invoke('snapshot')
    await window.locator('#xhs-provider').selectOption(snapshot.providers[0].id)
    await window.locator('#xhs-preview').click()
    await window.getByText('候选 1 篇，入选 1 篇；尚未发送。', { exact: true }).waitFor()
    assert.equal((await invoke('snapshot')).history.length, 0)
    await window.locator('#xhs-trace summary').click()
    await window.getByText('读取笔记原文', { exact: true }).waitFor()
    await window.locator('#xhs-notes').scrollIntoViewIfNeeded()
    await window.screenshot({ path: artifactPath('xiaohongshu-preview.png') })
    await window.locator('#xhs-create').click()
    assert.equal(
      await window.locator('[name="plugin.accountId"]').inputValue(),
      '1234567890abcdef12345678',
    )
    await window.getByRole('button', { name: '保存', exact: true }).click()
    await window.locator('#editor').waitFor({ state: 'hidden' })
    const source = (await invoke('snapshot')).tasks[0]
    assert.equal(source.enabled, false)
    await assert.rejects(invoke('saveTask', { ...source, providerId: '' }), /兴趣筛选/)
    await invoke('saveTask', {
      name: '每小时汇总',
      pluginId: 'minipush-digest',
      channelId: snapshot.channels[0].id,
      providerId: '',
      schedule: { type: 'interval', minutes: 60 },
      enabled: true,
      onlyChanged: true,
      config: { sourceTaskIds: source.id },
    })
    const digest = (await invoke('snapshot')).tasks.find(
      (task) => task.pluginId === 'minipush-digest',
    )!
    const result = await invoke('runTask', digest.id)
    assert.equal(result.status, 'sent')
    assert.equal(result.message?.sections?.[0].message.articles?.[0].kind, 'xiaohongshu')
    assert.match(result.message!.sections![0].message.articles![0].body, /原文/)
    assert.equal((await invoke('runTask', digest.id)).status, 'skipped')
    await invoke('xhsLogout')
    assert.equal((await invoke('runTask', digest.id)).status, 'failed')
    await window.locator('button[data-page="plugins"]').click()
    await window.getByRole('button', { name: '登录与兴趣发现', exact: true }).click()
    await window.getByText('尚未登录小红书', { exact: true }).waitFor()
    await window.setViewportSize({ width: 900, height: 620 })
    assert.equal(await window.evaluate(() => document.body.scrollWidth > innerWidth), false)
    await window.screenshot({ path: artifactPath('xiaohongshu-compact.png') })
    console.log(
      'PASS XHS login, UI preview, original content, worker bridge, digest delivery, dedup and logout failure',
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
