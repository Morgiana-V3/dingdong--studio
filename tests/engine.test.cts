import { testDouble } from './helpers/fixtures.cjs'
import type { Store } from '../src/store.cjs'
import type { Plugins } from '../src/plugins.cjs'
import type { Services } from '../src/services.cjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Engine } from '../src/engine.cjs'

function fixture(
  send: () => Promise<unknown>,
  output = { message: { title: 'test', body: 'body' }, state: { seen: ['a'] } },
) {
  const store = testDouble<Store>({
    state: {
      tasks: [
        {
          id: 'task',
          name: 'test',
          pluginId: 'example',
          channelId: 'phone',
          config: {},
          pluginState: { seen: [] },
          onlyChanged: true,
        },
      ],
      history: [],
    },
    save() {},
    redact(value: string) {
      return value
    },
  })
  const engine = new Engine(
    store,
    testDouble<Plugins>({ list: () => [{ id: 'example', location: '/tmp', entry: 'index.cjs' }] }),
    testDouble<Services>({ send }),
    testDouble<Engine['utilityProcess']>(null),
    () => {},
  )
  engine.execute = async () => output
  return { engine, store }
}
test('failed delivery preserves plugin checkpoint for a manual retry', async () => {
  const { engine, store } = fixture(async () => {
    throw new Error('offline')
  })
  const record = await engine.run('task')
  assert.equal(record.status, 'failed')
  assert.deepEqual(store.state.tasks[0].pluginState, { seen: [] })
  assert.equal(store.state.tasks[0].lastDigest, undefined)
})
test('success commits checkpoint and suppresses repeat delivery', async () => {
  let deliveries = 0
  const { engine, store } = fixture(async () => {
    deliveries += 1
  })
  assert.equal((await engine.run('task')).status, 'sent')
  assert.deepEqual(store.state.tasks[0].pluginState, { seen: ['a'] })
  assert.equal((await engine.run('task')).status, 'skipped')
  assert.equal(deliveries, 1)
})
test('missing plugin produces a failed history record', async () => {
  const { engine } = fixture(async () => {})
  engine.plugins.list = () => []
  assert.equal((await engine.run('task')).status, 'failed')
})
test('cancellation terminates plugin child and releases task lock', async () => {
  const { engine } = fixture(async () => {})
  let killed = false
  class Child extends EventEmitter {
    postMessage() {}
    kill() {
      killed = true
    }
  }
  engine.utilityProcess = testDouble<Engine['utilityProcess']>({ fork: () => new Child() })
  engine.execute = Engine.prototype.execute
  const running = engine.run('task')
  engine.running.get('task')!.abort()
  assert.equal((await running).status, 'failed')
  assert.equal(killed, true)
  assert.equal(engine.running.size, 0)
})
test('due task is claimed once and rescheduled before execution', async () => {
  const { engine, store } = fixture(async () => {})
  Object.assign(store.state.tasks[0], {
    enabled: true,
    nextRun: Date.now() - 1000,
    schedule: { type: 'interval', minutes: 1 },
  })
  engine.tick()
  engine.tick()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(store.state.history.length, 1)
  assert.ok(store.state.tasks[0].nextRun! > Date.now())
})
