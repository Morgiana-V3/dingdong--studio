import fs from 'node:fs'
import path from 'node:path'
import type { Store } from './store.cjs'

export interface XCookie {
  name: string
  value: string
}
export interface XCredentialStore {
  load(): XCookie[]
  save(cookies: XCookie[]): void
  clear(): void
}
const requiredCookies = ['auth_token', 'ct0', 'twid']
export function validateXCookies(input: XCookie[]): XCookie[] {
  const cookies = requiredCookies.map((name) => input.find((cookie) => cookie.name === name))
  if (cookies.some((cookie) => !cookie || !cookie.value || /[;\r\n]/.test(cookie.value))) {
    throw new Error('X 登录凭据不完整，请完成登录后重新导入')
  }
  return cookies.map((cookie) => ({ name: cookie!.name, value: cookie!.value }))
}
export class XCredentials implements XCredentialStore {
  private filename: string
  constructor(
    directory: string,
    private encryption: Pick<Store, 'encrypt' | 'decrypt'>,
  ) {
    this.filename = path.join(directory, 'x-session.encrypted.json')
  }
  load(): XCookie[] {
    if (!fs.existsSync(this.filename)) {
      return []
    }
    try {
      const envelope = JSON.parse(fs.readFileSync(this.filename, 'utf8')) as { secret: string }
      return validateXCookies(JSON.parse(this.encryption.decrypt(envelope.secret)))
    } catch {
      throw new Error('无法解密 X 登录，请解锁钥匙串，必要时重新导入登录')
    }
  }
  save(cookies: XCookie[]): void {
    const value = validateXCookies(cookies)
    const secret = this.encryption.encrypt(JSON.stringify(value))
    const temporary = this.filename + '.tmp'
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, secret }), { mode: 0o600 })
    fs.renameSync(temporary, this.filename)
  }
  clear(): void {
    fs.rmSync(this.filename, { force: true })
  }
}
