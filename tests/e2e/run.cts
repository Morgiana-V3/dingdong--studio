import { spawnSync } from 'node:child_process'
import path from 'node:path'

const suites = [
  'verify.cjs',
  'verify-controls.cjs',
  'verify-models.cjs',
  'verify-bilibili.cjs',
  'verify-tieba.cjs',
  'verify-x.cjs',
  'verify-xiaohongshu.cjs',
  'verify-xhs-reader.cjs',
  'verify-dingdong.cjs',
  'verify-digest.cjs',
]

for (const suite of suites) {
  const result = spawnSync(process.execPath, [path.join(__dirname, suite)], {
    stdio: 'inherit',
    env: process.env,
  })
  if (result.error || result.status !== 0) {
    console.error(`UI test failed: ${suite}`, result.error || result.signal || '')
    process.exitCode = result.status || 1
    break
  }
}
