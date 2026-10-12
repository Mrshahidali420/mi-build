/**
 * One sample reel per reel type, for the owner to look at before a reel is
 * switched on (FB_POST_TYPES). Nothing is posted and no ledger is read.
 *
 *   node scripts/social/reel/samples.mjs --out reel-samples
 *
 * For each type: <key>.mp4, and <key>.png, a contact sheet of six frames
 * taken from the finished video. captions.md holds the words. Needs ffmpeg
 * on the PATH (or FFMPEG_PATH).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { captionFor } from '../plan.mjs'
import { samplePosts, argsOf } from '../samples.mjs'
import { commentFor } from '../site.mjs'
import { frameAt } from './video.mjs'

export const SHEET = { frames: 6, width: 270, height: 480, gap: 12 }

/** The moments a contact sheet shows: one in the middle of each of `count` equal parts of the reel. */
export const sheetTimes = (seconds, count = SHEET.frames) => Array.from({ length: count }, (_, i) => Math.round(((i + 0.5) * seconds * 100) / count) / 100)

/** Six frames of a finished reel, side by side, as one PNG. */
export async function contactSheet(file, seconds, sharp) {
  const frames = []
  for (const at of sheetTimes(seconds)) frames.push(await sharp(await frameAt(file, at)).resize(SHEET.width, SHEET.height).png().toBuffer())
  const width = SHEET.frames * SHEET.width + (SHEET.frames + 1) * SHEET.gap
  return sharp({ create: { width, height: SHEET.height + SHEET.gap * 2, channels: 3, background: '#808080' } })
    .composite(frames.map((input, i) => ({ input, left: SHEET.gap + i * (SHEET.width + SHEET.gap), top: SHEET.gap })))
    .png()
    .toBuffer()
}

async function main() {
  const { out } = argsOf(process.argv.slice(2))
  const [{ REELS }, { THEME }, { renderReel }, { default: sharp }, source] = await Promise.all([import('../types/index.mjs'), import('../theme.mjs'), import('./engine.mjs'), import('sharp'), import('../source.mjs')])
  const now = Date.now()
  const dataAt = await source.dataLoader()
  const dir = resolve(out)
  mkdirSync(dir, { recursive: true })
  const notes = [`# ${THEME.name}: sample reels`, '']
  const lines = []
  for (const type of REELS) {
    const [sample] = await samplePosts(type, { per: 1, now, loadData: async (at) => dataAt(at) })
    if (!sample) {
      lines.push(`${type.key}: no data for this reel right now`)
      continue
    }
    const { mp4, seconds, pngs } = await renderReel(type, sample.post, { theme: THEME })
    const file = join(dir, `${type.key}.mp4`)
    writeFileSync(file, mp4)
    writeFileSync(join(dir, `${type.key}.png`), await contactSheet(file, seconds, sharp))
    const caption = captionFor(type, sample.post, 0, [...(source.BLOCKED_TAGS || [])])?.caption || '(no wording fits this post)'
    notes.push(`## ${type.name} (${type.key}.mp4, ${seconds} s, ${pngs.length} slides)`, '', 'Description:', '', ...caption.split('\n').map((l) => `> ${l}`), '', 'First comment:', '', ...commentFor(sample.post).split('\n').map((l) => `> ${l}`), '')
    lines.push(`${type.key}: ${seconds} s, ${pngs.length} slides, ${Math.round(mp4.length / 1024)} KB`)
  }
  writeFileSync(join(dir, 'captions.md'), `${notes.join('\n')}\n`)
  process.stdout.write(`${lines.join('\n')}\nSaved to ${dir}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
