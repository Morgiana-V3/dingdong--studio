import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'minipush-ui-'))
const data = path.join(directory, 'data')
const artifacts = path.join(directory, 'screenshots')
fs.mkdirSync(data)
fs.mkdirSync(artifacts)

function artifactPath(name: string) {
  return path.join(artifacts, name)
}

function cleanup() {
  if (process.env.MINIPUSH_KEEP_TEST_ARTIFACTS === '1') {
    console.log(`Test artifacts: ${directory}`)
    return
  }
  fs.rmSync(directory, { recursive: true, force: true })
}

export { data, artifactPath, cleanup }
