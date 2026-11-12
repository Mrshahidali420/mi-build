import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { frameJpeg, reelExtras } from '../scripts/social/ig.mjs'

test('reel options: a cover frame and a trial are only added when asked for', () => {
  assert.deepEqual(reelExtras(), {})
  assert.deepEqual(reelExtras({ thumbOffset: 1500 }), { thumb_offset: '1500' })
  assert.deepEqual(JSON.parse(reelExtras({ trial: true }).trial_params), { graduation_strategy: 'SS_PERFORMANCE' })
  assert.equal(reelExtras({ thumbOffset: 0, trial: false }).thumb_offset, undefined)
})

test('reel options: the cover is one frame cut out with ffmpeg', async () => {
  const calls = []
  const run = async (cmd, args) => {
    calls.push([cmd, args])
    writeFileSync(args.at(-1), Buffer.from('jpeg'))
  }
  const jpeg = await frameJpeg(Buffer.from('mp4'), 1.5, { run })
  assert.equal(jpeg.toString(), 'jpeg')
  assert.equal(calls[0][0], 'ffmpeg')
  assert.ok(calls[0][1].includes('-frames:v'))
  assert.ok(calls[0][1].includes('1.5'))
})
