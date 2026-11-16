import type { Settings } from './types.cjs'
import fs from 'node:fs'
import path from 'node:path'

class Store {
  filename: string
  safeStorage: Pick<
    typeof import('electron').safeStorage,
    'isEncryptionAvailable' | 'encryptString' | 'decryptString'
  >
  state: Settings
  constructor(directory: string, safeStorage: Store['safeStorage']) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.filename = path.join(directory, 'settings.json')
    this.safeStorage = safeStorage
    this.state = {
      version: 1,
      channels: [],
      providers: [],
      tasks: [],
      history: [],
      preferences: { startAtLogin: false },
    }
    if (fs.existsSync(this.filename)) {
      this.state = JSON.parse(fs.readFileSync(this.filename, 'utf8'))
    }
    for (const record of this.state.history) {
      if (record.status === 'running') {
        record.status = 'interrupted'
        record.detail = '应用退出导致执行中断。请检查推送记录后手动重试。'
      }
    }
    this.save()
  }

  encrypt(secret: string) {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('macOS 加密存储暂不可用，请解锁钥匙串后重试')
    }
    return this.safeStorage.encryptString(secret).toString('base64')
  }

  decrypt(secret: string | undefined) {
    if (!secret) {
      throw new Error('密钥未配置')
    }
    return this.safeStorage.decryptString(Buffer.from(secret, 'base64'))
  }

  redact(value: unknown) {
    let text = String(value)
    for (const config of [...this.state.channels, ...this.state.providers]) {
      try {
        text = text.split(this.decrypt(config.secret)).join('[密钥已隐藏]')
      } catch {
        // A locked keychain must not prevent displaying unrelated errors.
      }
    }
    return text.replace(/sk-[A-Za-z0-9_-]+|sctp\d+t[A-Za-z0-9_-]+/g, '[密钥已隐藏]')
  }

  save() {
    const temporary = this.filename + '.tmp'
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 })
    fs.renameSync(temporary, this.filename)
  }

  snapshot() {
    const state = structuredClone(this.state)
    for (const config of [...state.channels, ...state.providers]) {
      config.hasKey = Boolean(config.secret)
      delete config.secret
    }
    for (const task of state.tasks) {
      delete task.pluginState
      delete task.lastDigest
    }
    return state
  }
}

export { Store }
