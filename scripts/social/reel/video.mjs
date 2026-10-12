/**
 * A reel from still slides: a vertical MP4 put together with ffmpeg.
 *
 * Checked against Meta's Reels Publishing API page on 12 Oct 2026 (updated
 * 30 Jul 2026): .mp4, 9 x 16, 1080 x 1920, 24 to 60 fps at a fixed rate,
 * 3 to 90 seconds, H.264 with 4:2:0 chroma and a closed GOP of 2 to 5
 * seconds, AAC-LC stereo at 48 kHz. So: 30 fps, a key frame every 2 seconds,
 * yuv420p, and a silent AAC track (no music, by the owner's rule).
 *
 * Each slide is held for a few seconds with a slow zoom, and the slides
 * cross-fade into each other. The reel is kept between 8 and 20 seconds: with
 * many slides each one is held a little shorter.
 *
 * ffmpegArgs() is pure, so the command can be tested without running it.
 */
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const REEL = { width: 1080, height: 1920, fps: 30 }
/** Seconds the opening slide, each item and the closing slide are held, and the length of a cross-fade. */
export const HOLD = { title: 2.4, item: 2.6, end: 3, fade: 0.4, itemMin: 1.5 }
export const LENGTH = { min: 8, max: 20 }
/** How far a slide grows while it is held: slow enough to read. */
export const ZOOM = 0.05
const GOP_SECONDS = 2
/** The still is enlarged before the zoom, so the slow move does not shake. */
const OVERSAMPLE = 2
const FFMPEG_TIMEOUT_MS = 180_000

const round = (n) => Math.round(n * 100) / 100

/** A reel's length: the slides, less what each cross-fade shares between two of them. */
export const lengthOf = (holds, fade = HOLD.fade) => round(holds.reduce((sum, s) => sum + s, 0) - fade * (holds.length - 1))

/**
 * How long each slide is held: [title, ...items, end]. The items share what
 * the longest reel leaves them, and a short reel is stretched to the least.
 */
export function holdsOf(items) {
  const fades = HOLD.fade * (items + 1)
  const room = LENGTH.max - HOLD.title - HOLD.end + fades
  const need = LENGTH.min - HOLD.title - HOLD.end + fades
  // The most is rounded down and the least up, so the sum never leaves the limits by a rounding.
  const most = Math.floor((room / items) * 100) / 100
  const least = Math.ceil((need / items) * 100) / 100
  const each = Math.max(least, Math.min(HOLD.item, most), Math.min(HOLD.itemMin, most))
  return [HOLD.title, ...Array.from({ length: items }, () => each), HOLD.end]
}

/**
 * The ffmpeg command for these slides.
 * @param frames paths of the slide pictures, in order
 * @param holds seconds each one is held (holdsOf)
 */
export function ffmpegArgs({ frames, holds, out, fade = HOLD.fade, size = REEL }) {
  const { width, height, fps } = size
  const total = lengthOf(holds, fade)
  const inputs = frames.flatMap((file) => ['-i', file])
  const moves = holds.map((hold, i) => {
    const count = Math.round(hold * fps)
    return `[${i}:v]scale=${width * OVERSAMPLE}:${height * OVERSAMPLE},zoompan=z='1+${ZOOM}*on/${count}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${count}:s=${width}x${height}:fps=${fps},setsar=1,format=yuv420p[v${i}]`
  })
  const fades = []
  let at = 0
  for (let i = 1; i < holds.length; i += 1) {
    at = round(at + holds[i - 1] - fade)
    fades.push(`[${i === 1 ? 'v0' : `x${i - 1}`}][v${i}]xfade=transition=fade:duration=${fade}:offset=${at}[x${i}]`)
  }
  const last = holds.length > 1 ? `x${holds.length - 1}` : 'v0'
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    ...inputs,
    '-f',
    'lavfi',
    '-t',
    String(total),
    '-i',
    'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-filter_complex',
    [...moves, ...fades].join(';'),
    '-map',
    `[${last}]`,
    '-map',
    `${frames.length}:a`,
    ...['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(fps)],
    // A closed GOP of two seconds, at a fixed frame rate.
    ...['-g', String(GOP_SECONDS * fps), '-keyint_min', String(GOP_SECONDS * fps), '-sc_threshold', '0', '-flags', '+cgop'],
    ...['-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2'],
    ...['-t', String(total), '-movflags', '+faststart', out],
  ]
}

const runFfmpeg = (bin, args) =>
  new Promise((done, fail) => {
    execFile(bin, args, { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }, (error, stdout, stderr) => (error ? fail(new Error(`ffmpeg failed: ${String(stderr || error.message).slice(-400)}`)) : done(stdout)))
  })

/**
 * The slides as one MP4.
 * @param pngs the slide pictures, in order
 * @returns {Promise<{ mp4: Buffer, seconds: number }>}
 */
export async function assemble(pngs, { ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg', run = runFfmpeg } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'reel-'))
  try {
    const frames = pngs.map((png, i) => {
      const file = join(dir, `slide-${String(i).padStart(2, '0')}.png`)
      writeFileSync(file, png)
      return file
    })
    const holds = holdsOf(Math.max(1, pngs.length - 2))
    const out = join(dir, 'reel.mp4')
    await run(ffmpeg, ffmpegArgs({ frames, holds, out }))
    return { mp4: readFileSync(out), seconds: lengthOf(holds) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** One frame of an MP4 as a PNG, `at` seconds in (for the contact sheet of a sample). */
export async function frameAt(file, at, { ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg', run = runFfmpeg } = {}) {
  return run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'])
}
