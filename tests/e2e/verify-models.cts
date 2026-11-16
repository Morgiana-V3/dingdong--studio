import { _electron as electron } from '@playwright/test'
import { data, artifactPath, cleanup } from './environment.cjs'
import path from 'node:path'
import assert from 'node:assert/strict'
const root = path.resolve(__dirname, '../..')
async function main() {
  const application = await electron.launch({
    args: [path.join(root, 'tests/e2e/test-entry.cjs')],
    env: {
      ...process.env,
      MINIPUSH_TEST_DATA: data,
      MINIPUSH_SEED: '',
      MINIPUSH_MODEL_TEST: '1',
    },
  })
  try {
    const window = await application.firstWindow()
    await window.waitForSelector('#toolbar button')
    await window.locator('[data-page="providers"]').click()
    await window.locator('#toolbar [data-action="editProvider"]').click()
    await window.locator('[name="key"]').fill('test-key')
    await window.locator('#fetch-models').click()
    await window.getByText('已获取 3 个模型，筛选匹配 3 个。').waitFor()
    assert.equal(await window.locator('[name="model"] option').count(), 3)
    await window.locator('#model-search').fill('gpt-test')
    await window.locator('[name="model"]').selectOption('gpt-test')
    await window.locator('#model-search').fill('nothing-matches')
    assert.equal(await window.locator('[name="model"]').inputValue(), 'gpt-test')
    await window.getByRole('button', { name: '保存', exact: true }).click()
    let state = await window.evaluate(() => globalThis.window.miniPush.invoke('snapshot'))
    assert.equal(state.providers[0].model, 'gpt-test')
    assert.equal(state.providers[0].hasKey, true)
    await window.getByRole('button', { name: '编辑', exact: true }).click()
    await window.locator('#fetch-models').click()
    await window.getByText('已获取 3 个模型，筛选匹配 3 个。').waitFor()
    await window.locator('#manual-model').click()
    await window.locator('[name="model"]').fill('custom-model')
    await window.locator('#manual-model').click()
    assert.equal(await window.locator('[name="model"]').inputValue(), 'custom-model')
    await window.locator('[name="key"]').fill('bad-key')
    await window.locator('#fetch-models').click()
    await window.locator('#model-status').filter({ hasText: 'HTTP 401' }).waitFor()
    assert.equal(await window.locator('[name="model"]').inputValue(), 'custom-model')
    await window.locator('[name="key"]').fill('')
    await window.locator('[name="baseUrl"]').fill('https://example.com/v1')
    await window.locator('#fetch-models').click()
    await window.locator('#model-status').filter({ hasText: '重新填写' }).waitFor()
    await window.locator('[name="baseUrl"]').fill('https://api.openai.com/v1')
    await window.locator('#fetch-models').click()
    await window.getByText('已获取 3 个模型，筛选匹配 3 个。').waitFor()
    await window.locator('[name="model"]').selectOption('gpt-test')
    await window.locator('#model-control').scrollIntoViewIfNeeded()
    await window.screenshot({ path: artifactPath('models.png') })
    await window.getByRole('button', { name: '保存', exact: true }).click()
    state = await window.evaluate(() => globalThis.window.miniPush.invoke('snapshot'))
    assert.equal(state.providers[0].model, 'gpt-test')
    console.log(
      'PASS model fetch, filter, selection persistence, manual input, saved keys, error recovery and endpoint protection',
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
