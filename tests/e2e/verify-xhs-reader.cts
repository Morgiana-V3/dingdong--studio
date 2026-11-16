import { _electron as electron } from '@playwright/test'
import path from 'node:path'
import assert from 'node:assert/strict'
import { data, cleanup } from './environment.cjs'
import { accountId, noteId } from '../helpers/xhs-fixtures.cjs'
const root = path.resolve(__dirname, '../..')
async function main() {
  const app = await electron.launch({
    args: [path.join(root, 'tests/e2e/test-entry.cjs')],
    env: { ...process.env, MINIPUSH_TEST_DATA: data, MINIPUSH_SEED: '' },
  })
  try {
    await app.firstWindow()
    const result = await app.evaluate(
      async ({ session, BrowserWindow }, input) => {
        const load = process.getBuiltinModule('module').createRequire(input.source)
        const { Xiaohongshu } = load(input.source) as typeof import('../../src/xiaohongshu.cjs')
        const s = session.fromPartition('xhs-reader-fixture')
        let mismatch = false
        const destinations: string[] = []
        await s.protocol.handle('https', async (request) => {
          const url = new URL(request.url)
          if (url.pathname.includes('/api/')) {
            const payload = JSON.parse(await request.text()) as { keyword: string }
            destinations.push('API:' + payload.keyword)
            await new Promise((resolve) => setTimeout(resolve, 120))
            const body =
              payload.keyword === '失败'
                ? { code: 300012, success: false }
                : payload.keyword === '无结果'
                  ? { code: 0, success: true, data: { has_more: false } }
                  : { code: 0, success: true, data: { items: [input.card], has_more: false } }
            return new Response(JSON.stringify(body), {
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            })
          }
          destinations.push(url.pathname)
          const state = {
            user: {
              userInfo: {
                value: {
                  guest: false,
                  userId: mismatch ? 'aaaaaaaaaaaaaaaaaaaaaaaa' : input.accountId,
                },
              },
            },
            feed: { feeds: { value: [input.card] } },
            search: {
              feeds: { value: [] },
              state: { value: 'loading' },
              searchContext: { value: { keyword: url.searchParams.get('keyword') } },
            },
          }
          return new Response(
            `<html><body><script>window.__INITIAL_STATE__=${JSON.stringify(state)};const keyword=new URL(location.href).searchParams.get('keyword');if(keyword){fetch('https://www.xiaohongshu.com/api/sns/web/v1/search/notes',{method:'POST',body:JSON.stringify({keyword,page:1}),headers:{'Content-Type':'application/json'}}).then(r=>r.json()).then(data=>{const s=window.__INITIAL_STATE__.search;s.feeds.value=data.data?.items||[];s.state.value=s.feeds.value.length?'success':'error'})}</script></body></html>`,
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          )
        })
        const service = new Xiaohongshu(s, BrowserWindow)
        const feed = await service
          .feed({ accountId: input.accountId }, AbortSignal.timeout(5000))
          .catch((error) => {
            throw new Error(
              'feed: ' + error.message + ' destinations: ' + JSON.stringify(destinations),
            )
          })
        const start = Date.now()
        const found = await service
          .search({ accountId: input.accountId, query: 'AI 工具' }, AbortSignal.timeout(5000))
          .catch((error) => {
            throw new Error('search: ' + error.message + ' ' + JSON.stringify(destinations))
          })
        const empty = await service
          .search({ accountId: input.accountId, query: '无结果' }, AbortSignal.timeout(5000))
          .catch((error) => {
            throw new Error('empty: ' + error.message)
          })
        let failed = ''
        try {
          await service.search(
            { accountId: input.accountId, query: '失败' },
            AbortSignal.timeout(5000),
          )
        } catch (error) {
          failed = String(error)
        }
        mismatch = true
        let wrongAccount = ''
        try {
          await service.feed({ accountId: input.accountId }, AbortSignal.timeout(5000))
        } catch (error) {
          wrongAccount = String(error)
        }
        await service.logout()
        s.protocol.unhandle('https')
        const imageWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
        await imageWindow.loadURL('about:blank')
        const webp: string = await imageWindow.webContents.executeJavaScript(
          `(()=>{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const context=canvas.getContext('2d');context.fillStyle='#e14268';context.fillRect(0,0,64,64);return canvas.toDataURL('image/webp')})()`,
        )
        imageWindow.destroy()
        const { compactRaster } = load(input.raster) as typeof import('../../src/raster-image.cjs')
        const jpeg = await compactRaster(webp, 2000)
        return {
          imageConverted:
            jpeg.startsWith('data:image/jpeg;base64,') &&
            Buffer.from(jpeg.split(',')[1], 'base64').length <= 2000,
          feed: feed.notes.length,
          found: found.notes.length,
          empty: empty.notes.length,
          failed,
          wrongAccount,
          destinations,
          elapsed: Date.now() - start,
        }
      },
      {
        source: path.join(root, 'src/xiaohongshu.cjs'),
        raster: path.join(root, 'src/raster-image.cjs'),
        accountId,
        card: {
          id: noteId,
          xsecToken: 'fixture-token',
          modelType: 'note',
          noteCard: { displayTitle: '标题', interactInfo: { likedCount: '12' } },
        },
      },
    )
    assert.equal(result.imageConverted, true)
    assert.equal(result.feed, 1)
    assert.equal(result.found, 1)
    assert.equal(result.empty, 0)
    assert.match(result.failed, /搜索接口未成功/)
    assert.match(result.wrongAccount, /当前账号与任务不同/)
    assert.ok(result.destinations.includes('/search_result/'))
    assert.ok(result.elapsed < 15000)
    console.log(
      'PASS actual Electron hidden reader startup, delayed search, confirmed empty, API failure and account isolation',
    )
  } finally {
    await app.close()
  }
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(cleanup)
