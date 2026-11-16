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
      MINIPUSH_DINGDONG_TEST: '1',
    },
  })
  try {
    const page = await application.firstWindow()
    await page.waitForSelector('#toolbar button')
    const invoke = createInvoker(page)
    await page.locator('button[data-page="channels"]').click()
    await page.locator('#toolbar').getByRole('button', { name: '添加渠道', exact: true }).click()
    assert.equal(await page.locator('[name="kind"]').inputValue(), 'dingdong')
    await page.locator('[name="name"]').fill('叮咚手机')
    await page.locator('[name="baseUrl"]').fill('127.0.0.1:8080')
    await page.locator('[name="source"]').fill('MiniPush 测试')
    await page.locator('[name="key"]').fill('fictional-send-token-'.repeat(3))
    await page.locator('[name="silent"]').check()
    await page.screenshot({ path: artifactPath('dingdong-channel.png') })
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.locator('#editor').waitFor({ state: 'hidden' })
    const channel = (await invoke('snapshot')).channels[0]
    assert.equal(channel.baseUrl, 'http://127.0.0.1:8080')
    assert.equal(channel.silent, true)
    assert.equal(channel.secret, undefined)
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    assert.equal(await page.locator('[name="key"]').inputValue(), '')
    await page.locator('[name="baseUrl"]').fill('https://different.example')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page
      .getByText('接收方式或服务器地址已更改，请重新填写对应的发送密钥', { exact: true })
      .waitFor()
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await invoke('testChannel', channel.id)
    const record = (await invoke('snapshot')).history[0]
    assert.equal(record.delivery?.status, 'queued')
    assert.equal(record.delivery?.messageId, record.id)
    await page.reload()
    await page.locator('button[data-page="history"]').click()
    await page.locator('[data-action="viewRecord"]').first().click()
    await page.getByRole('button', { name: '查询送达状态', exact: true }).click()
    await page.getByText('手机已保存正文（不代表已读）', { exact: true }).waitFor()
    assert.equal((await invoke('snapshot')).history[0].delivery?.status, 'received')
    const previewPromise = application.waitForEvent('window')
    await page.getByRole('button', { name: '预览 HTML 正文', exact: true }).click()
    const preview = await previewPromise
    await preview.waitForSelector('h2')
    await preview.screenshot({ path: artifactPath('dingdong-document.png') })
    assert.equal(await preview.locator('img').count(), 1)
    await preview.close()
    await page.setViewportSize({ width: 900, height: 620 })
    assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false)
    console.log(
      'PASS Dingdong server address, encrypted credential editing, endpoint isolation, silent setting and persisted phone receipt',
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
