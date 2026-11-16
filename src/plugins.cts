import { DIGEST_ID, digestPlugin } from './digest.cjs'
import type { InstalledPlugin } from './types.cjs'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { validateManifest } from './domain.cjs'

class Plugins {
  constructor(public directory: string) {
    fs.mkdirSync(directory, { recursive: true })
  }

  list() {
    const plugins: InstalledPlugin[] = []
    for (const name of fs.readdirSync(this.directory)) {
      const location = path.join(this.directory, name)
      try {
        const manifest = validateManifest(
          JSON.parse(fs.readFileSync(path.join(location, 'plugin.json'), 'utf8')),
        )
        plugins.push({ ...manifest, location })
      } catch {
        // Incomplete imports never appear as installed plugins.
      }
    }
    return [...plugins.filter((plugin) => plugin.id !== DIGEST_ID), digestPlugin]
  }

  import(source: string) {
    const manifest = validateManifest(
      JSON.parse(fs.readFileSync(path.join(source, 'plugin.json'), 'utf8')),
    )
    if (manifest.id === DIGEST_ID) {
      throw new Error('统一推送为内置插件，不能覆盖导入')
    }
    const destination = path.join(this.directory, manifest.id)
    if (fs.existsSync(destination)) {
      throw new Error('相同 ID 的插件已安装。请先删除依赖任务并移除旧插件。')
    }
    let bytes = 0
    function inspect(directory: string) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name)
        if (entry.isSymbolicLink()) {
          throw new Error('插件目录不能包含符号链接')
        }
        if (entry.isDirectory()) {
          inspect(filename)
        } else {
          bytes += fs.statSync(filename).size
        }
        if (bytes > 20 * 1024 * 1024) {
          throw new Error('插件目录不能超过 20 MB')
        }
      }
    }
    inspect(source)
    if (!fs.statSync(path.join(source, manifest.entry)).isFile()) {
      throw new Error('找不到插件入口')
    }
    const temporary = path.join(this.directory, '.import-' + crypto.randomUUID())
    fs.cpSync(source, temporary, { recursive: true })
    fs.renameSync(temporary, destination)
    return manifest
  }
}

export { Plugins }
