import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyMobileCommand,
  mobileSnapshot,
  MobileControl,
  type MobileCommand,
} from '../src/mobile-control.cjs'
import type { Snapshot, TaskInput } from '../src/types.cjs'
import { settings } from './helpers/fixtures.cjs'

function fixture(): Snapshot {
  return {
    ...settings(),
    plugins: [
      {
        id: 'bilibili-videos',
        name: 'B 站',
        version: '1',
        apiVersion: 1,
        entry: 'index.cjs',
        location: '/private/path',
        fields: [],
      },
    ],
    tasks: [
      {
        id: 'task',
        name: '订阅',
        pluginId: 'bilibili-videos',
        channelId: 'phone',
        providerId: '',
        schedule: { type: 'daily', times: ['09:00'] },
        enabled: true,
        onlyChanged: true,
        config: { upIds: '1' },
        nextRun: 123,
        pluginState: { cookie: 'private-state' },
        lastDigest: 'private-hash',
      },
    ],
    channels: [
      {
        id: 'phone',
        name: '手机',
        kind: 'dingdong',
        secret: 'private-channel',
        baseUrl: 'https://private.example',
      },
    ],
    providers: [
      {
        id: 'ai',
        name: 'AI',
        secret: 'private-api',
        baseUrl: 'private-address',
        model: 'model',
        maxOutputTokens: 100,
      },
    ],
    history: [
      {
        id: 'record',
        taskId: 'task',
        name: 'private-title',
        startedAt: 1,
        status: 'sent',
        detail: 'private-body',
      },
    ],
    running: [],
  }
}
function command(state: Snapshot, overrides: Partial<MobileCommand> = {}): MobileCommand {
  return {
    id: 'command',
    session: 'session',
    revision: mobileSnapshot(state).revision,
    action: 'setEnabled',
    payload: { id: 'task', enabled: false },
    ttlMs: 20000,
    ...overrides,
  }
}

test('mobile snapshots exclude secrets, history, execution state and local paths', () => {
  const state = fixture()
  const snapshot = mobileSnapshot(state)
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /private|secret|location|pluginState|lastDigest|history/,
  )
  state.tasks[0].nextRun = 456
  state.tasks[0].pluginState = { cursor: 2 }
  state.running = ['task']
  assert.equal(mobileSnapshot(state).revision, snapshot.revision)
  state.tasks[0].config.upIds = '2'
  assert.notEqual(mobileSnapshot(state).revision, snapshot.revision)
})

test('remote edits use the shared save handler and reject stale edits and unknown operations', () => {
  const state = fixture()
  let saved: TaskInput | undefined
  const actions = {
    snapshot: () => state,
    saveTask: (input: TaskInput) => {
      saved = input
    },
    deleteTask: () => {},
  }
  const request = command(state)
  applyMobileCommand(actions, request)
  assert.equal(saved?.enabled, false)
  assert.deepEqual(saved?.schedule, { type: 'daily', times: ['09:00'] })
  assert.deepEqual(saved?.config, { upIds: '1' })
  assert.throws(
    () => applyMobileCommand(actions, command(state, { action: 'saveProvider' })),
    /不支持/,
  )
  assert.throws(
    () =>
      applyMobileCommand(
        actions,
        command(state, { action: 'saveTask', payload: { ...state.tasks[0], id: 'deleted' } }),
      ),
    /不存在/,
  )
  assert.throws(
    () =>
      applyMobileCommand(
        actions,
        command(state, {
          action: 'saveTask',
          payload: { ...state.tasks[0], pluginId: 'custom-code' },
        }),
      ),
    /内置/,
  )
  state.tasks[0].name = '电脑修改'
  assert.throws(() => applyMobileCommand(actions, request), /其他位置修改/)
})

test('running-task and digest validation failures propagate without pretending to save', () => {
  const state = fixture()
  const actions = {
    snapshot: () => state,
    saveTask: () => {
      throw new Error('内容源由汇总管理')
    },
    deleteTask: () => {},
  }
  assert.throws(() => applyMobileCommand(actions, command(state)), /汇总/)
})

test('disabling mobile management while a poll is in flight prevents mutation', async () => {
  const state = fixture()
  let enabled = true
  let edits = 0
  let finish: (() => void) | undefined
  const done = new Promise<void>((resolve) => {
    finish = resolve
  })
  const control = new MobileControl(
    () =>
      enabled ? { id: 'phone', baseUrl: 'https://relay.example', key: 'test-key' } : undefined,
    {
      snapshot: () => state,
      saveTask: () => {
        edits++
      },
      deleteTask: () => {},
    },
    async (_url, options) => {
      const sent = JSON.parse(options.body as string)
      enabled = false
      return {
        ok: true,
        status: 200,
        json: async () => {
          finish!()
          return { commands: [command(state, { session: sent.session })] }
        },
      }
    },
    () => {},
    (message) => message,
  )
  control.start()
  await done
  await new Promise((resolve) => setImmediate(resolve))
  control.stop()
  assert.equal(edits, 0)
})
