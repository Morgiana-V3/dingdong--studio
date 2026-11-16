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
      MINIPUSH_BILIBILI_TEST: '1',
    },
  })
  try {
    const window = await application.firstWindow()
    await window.waitForSelector('#toolbar button')
    const invoke = createInvoker(window)
    await invoke('saveChannel', { name: '测试手机', kind: 'sc3', key: 'sctp123ttest' })
    await window.reload()
    await window.locator('[data-page="plugins"]').click()
    await window.getByRole('button', { name: '安装 B 站插件', exact: true }).click()
    await window.getByRole('button', { name: '登录与订阅', exact: true }).click()
    await window.getByText('尚未登录 B 站', { exact: true }).waitFor()
    await window.getByRole('button', { name: '登录 B 站', exact: true }).click()
    await window.getByRole('button', { name: '刷新登录状态', exact: true }).click()
    await window.getByText('科技 UP', { exact: true }).waitFor()
    await window.locator('#bili-followings input[value="200"]').check()
    await window.locator('#bili-search').fill('编程')
    assert.equal(await window.locator('#bili-followings input').count(), 1)
    await window.locator('#bili-search').fill('')
    assert.equal(await window.locator('#bili-followings input[value="200"]').isChecked(), true)
    await window.getByRole('button', { name: '预览所选 UP 主的视频', exact: true }).click()
    await window.getByText('新的 AI 工具', { exact: true }).waitFor()
    await window.setViewportSize({ width: 900, height: 620 })
    await window.screenshot({ path: artifactPath('bilibili-panel.png') })
    await window.getByRole('button', { name: '配置推送任务', exact: true }).click()
    assert.equal(await window.locator('[name="plugin.accountMid"]').inputValue(), '100')
    assert.equal(await window.locator('[name="plugin.upIds"]').inputValue(), '200')
    await window.locator('[name="scheduleType"]').selectOption('manual')
    await window.getByRole('button', { name: '保存', exact: true }).click()
    let state = await invoke('snapshot')
    assert.equal(state.tasks[0].pluginId, 'bilibili-videos')
    let result = await invoke('runTask', state.tasks[0].id)
    assert.equal(result.status, 'skipped')
    assert.match(result.detail, /基线/)
    result = await invoke('runTask', state.tasks[0].id)
    assert.equal(result.status, 'sent')
    assert.match(result.message!.body, /新的 AI 工具/)
    result = await invoke('runTask', state.tasks[0].id)
    assert.equal(result.status, 'skipped')
    await invoke('bilibiliLogout')
    result = await invoke('runTask', state.tasks[0].id)
    assert.equal(result.status, 'failed')
    assert.match(result.detail, /登录/)
    state = await invoke('snapshot')
    assert.equal(JSON.stringify(state).includes('SESSDATA'), false)
    console.log(
      'PASS Bilibili install, account UI, filtered selection, preview, task wizard, source bridge, baseline, mock delivery, dedup and expired login',
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
