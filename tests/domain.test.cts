import { testDouble } from './helpers/fixtures.cjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { nextRun, validateSchedule, channelEndpoint, validateManifest } from '../src/domain.cjs'

test('daily schedule follows Shanghai time and advances after the deadline', () => {
  const schedule = { type: 'daily', time: '08:00' }
  assert.equal(
    nextRun(schedule, Date.parse('2026-11-14T00:00:00Z')),
    Date.parse('2026-11-15T00:00:00Z'),
  )
  assert.equal(
    nextRun(schedule, Date.parse('2026-11-13T23:59:00Z')),
    Date.parse('2026-11-14T00:00:00Z'),
  )
})
test('invalid schedules cannot cause a tight loop', () => {
  assert.throws(() => nextRun({ type: 'interval', minutes: 0 }))
  assert.throws(() => nextRun({ type: 'daily', time: '27:00' }))
  assert.equal(nextRun({ type: 'manual' }), null)
})
test('ServerChan endpoint is derived from a validated key', () => {
  assert.equal(
    channelEndpoint('sc3', 'sctp123ttest'),
    'https://123.push.ft07.com/send/sctp123ttest.send',
  )
  assert.throws(() => channelEndpoint('sc3', 'https://attacker.example'))
})
test('plugin entry cannot escape the plugin directory', () => {
  assert.throws(() =>
    validateManifest({
      id: 'example',
      name: 'Example',
      version: '1',
      apiVersion: 1,
      entry: '../file.cjs',
      fields: [],
    }),
  )
})

test('multiple daily times select the next occurrence and roll across midnight', () => {
  const schedule = { type: 'daily', times: ['20:00', '04:00', '12:00'] }
  const validated = validateSchedule(schedule)
  assert.equal(validated.type, 'daily')
  assert.deepEqual(validated.times, ['04:00', '12:00', '20:00'])
  for (const [now, expected] of [
    ['2026-11-15T03:59:59+08:00', '2026-11-15T04:00:00+08:00'],
    ['2026-11-15T04:00:00+08:00', '2026-11-15T12:00:00+08:00'],
    ['2026-11-15T12:10:00+08:00', '2026-11-15T20:00:00+08:00'],
    ['2026-11-15T20:00:00+08:00', '2026-11-16T04:00:00+08:00'],
  ]) {
    assert.equal(nextRun(schedule, Date.parse(now)), Date.parse(expected))
  }
  assert.deepEqual(validateSchedule({ type: 'daily', time: '04:00' }), {
    type: 'daily',
    times: ['04:00'],
  })
})
test('daily times reject blanks, duplicates, malformed times and excessive entries', () => {
  for (const times of [
    [],
    ['04:00', '04:00'],
    [''],
    ['4:00'],
    ['24:00'],
    ['12:60'],
    [400],
    Array(25).fill('04:00'),
  ]) {
    assert.throws(() => validateSchedule(testDouble({ type: 'daily', times })))
  }
})
