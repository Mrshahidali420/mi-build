// The sound of a reel (reel/sound.mjs, audio/): which track a reel gets, the
// audio half of the ffmpeg command, the licence list, and, where ffmpeg is
// installed, that a built reel really carries an audio stream.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { AUDIO_DIR, SOUND, TRACKS, cuesOf, soundGraph, trackFor } from '../scripts/social/reel/sound.mjs'
import { assemble, ffmpegArgs, holdsOf, lengthOf, HOLD } from '../scripts/social/reel/video.mjs'

const MAX_AUDIO_BYTES = 5 * 1024 * 1024
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const hasFfmpeg = spawnSync(FFMPEG, ['-version']).status === 0

test('tracks: four to six files, each in the folder and each listed as CC0 with its page', () => {
  assert.ok(TRACKS.length >= 4 && TRACKS.length <= 6)
  const sources = readFileSync(join(AUDIO_DIR, 'SOURCES.md'), 'utf8')
  let bytes = 0
  for (const file of TRACKS) {
    assert.ok(existsSync(join(AUDIO_DIR, file)), file)
    bytes += statSync(join(AUDIO_DIR, file)).size
    const row = sources.split('\n').find((line) => line.startsWith(`| ${file} |`))
    assert.ok(row, `${file} is not in SOURCES.md`)
    assert.match(row, /https:\/\/\S+/)
    assert.match(row, /CC0 1\.0/)
  }
  assert.ok(bytes < MAX_AUDIO_BYTES, `${bytes} bytes of music`)
})

test('tracks: a reel always gets the same track, and never the one the reel before it had', () => {
  assert.equal(trackFor('reel-x:1'), trackFor('reel-x:1'))
  const used = new Set(Array.from({ length: 60 }, (_, i) => trackFor(`reel-x:${i}`)))
  assert.equal(used.size, TRACKS.length)
  for (let i = 0; i < 60; i += 1) {
    const own = trackFor(`reel-x:${i}`)
    const next = trackFor(`reel-x:${i}`, own)
    assert.notEqual(next, own)
    assert.ok(TRACKS.includes(next))
    assert.equal(trackFor(`reel-x:${i}`, own), next)
  }
})

test('cues: a whoosh on every change of slide and a hit as the closing slide comes in', () => {
  const holds = holdsOf(3)
  const cues = cuesOf(holds, HOLD.fade)
  assert.deepEqual(cues.map((c) => c.kind), ['whoosh', 'whoosh', 'whoosh', 'hit'])
  assert.equal(cues[0].at, HOLD.title - HOLD.fade)
  assert.ok(cues.at(-1).at < lengthOf(holds))
})

test('command: with a track the reel has music under the effects, faded, at -16 LUFS, AAC at 128k or more', () => {
  const holds = holdsOf(2)
  const args = ffmpegArgs({ frames: ['a.png', 'b.png', 'c.png', 'd.png'], holds, out: 'reel.mp4', track: 'bed.m4a' })
  const value = (flag) => args[args.indexOf(flag) + 1]
  assert.deepEqual(args.slice(args.indexOf('-stream_loop'), args.indexOf('-stream_loop') + 4), ['-stream_loop', '-1', '-i', 'bed.m4a'])
  assert.ok(!args.some((a) => String(a).includes('anullsrc')))
  const graph = value('-filter_complex')
  assert.match(graph, /\[4:a\]atrim=0:/)
  assert.match(graph, /sidechaincompress/)
  assert.match(graph, /afade=t=in/)
  assert.match(graph, /afade=t=out/)
  assert.match(graph, new RegExp(`loudnorm=I=${SOUND.lufs}:`))
  assert.equal((graph.match(/anoisesrc=d=0\.45/g) || []).length, 2) // two whooshes
  assert.equal((graph.match(/sine=f=58/g) || []).length, 1) // one hit
  assert.ok(args.includes('[aout]'))
  assert.deepEqual([value('-c:a'), value('-ar'), value('-ac')], ['aac', '48000', '2'])
  assert.ok(Number.parseInt(value('-b:a'), 10) >= 128)
  assert.equal(soundGraph({ input: 4, holds, fade: HOLD.fade, total: lengthOf(holds) }).out, 'aout')
})

test('built: a reel made with ffmpeg carries a stereo AAC stream that is not silent', { skip: !hasFfmpeg && 'ffmpeg is not installed here' }, async () => {
  const size = { width: 180, height: 320, fps: 30 }
  const slide = (background) => sharp({ create: { width: size.width, height: size.height, channels: 3, background } }).png().toBuffer()
  const pngs = await Promise.all(['#a33', '#3a3', '#33a'].map(slide))
  const { mp4 } = await assemble(pngs, { ffmpeg: FFMPEG, track: join(AUDIO_DIR, TRACKS[0]), size })
  const probe = spawnSync(FFMPEG, ['-hide_banner', '-i', 'pipe:0', '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { input: mp4, encoding: 'utf8' })
  assert.match(probe.stderr, /Audio: aac[^\n]*48000 Hz, stereo/)
  const mean = Number(probe.stderr.match(/mean_volume: (-?[\d.]+) dB/)?.[1])
  assert.ok(mean > -35 && mean < -8, `mean volume ${mean} dB`)
})
