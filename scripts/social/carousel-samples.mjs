/**
 * Sample Instagram swipe posts (carousels), for the owner to look at before
 * they go live. Nothing is posted and no ledger is read.
 *
 *   node scripts/social/carousel-samples.mjs --out carousel-samples
 *
 * For each type with a swipe post: <key>-1.jpg, <key>-2.jpg, ... (the slides,
 * hook first) and <key>.png, all slides side by side.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { samplePosts, argsOf } from './samples.mjs'

const SHEET = { width: 324, height: 405, gap: 12 }

async function main() {
  const { out } = argsOf(process.argv.slice(2))
  const [{ REELS, TYPES }, { THEME }, { renderCarousel }, { default: sharp }, source] = await Promise.all([import('./types/index.mjs'), import('./theme.mjs'), import('./reel/engine.mjs'), import('sharp'), import('./source.mjs')])
  const dataAt = await source.dataLoader()
  const dir = resolve(out)
  mkdirSync(dir, { recursive: true })
  for (const type of REELS.filter((r) => r.carousel)) {
    const base = TYPES.find((t) => t.key === type.carouselOf)
    const [sample] = await samplePosts(base, { per: 1, now: Date.now(), loadData: async (at) => dataAt(at) })
    if (!sample) {
      process.stdout.write(`${type.key}: no data right now\n`)
      continue
    }
    const jpegs = await renderCarousel(type, type.fromPost(sample.post), { theme: THEME })
    jpegs.forEach((jpeg, i) => writeFileSync(join(dir, `${base.key}-${i + 1}.jpg`), jpeg))
    const tiles = await Promise.all(jpegs.map((jpeg) => sharp(jpeg).resize(SHEET.width, SHEET.height).png().toBuffer()))
    const width = tiles.length * SHEET.width + (tiles.length + 1) * SHEET.gap
    const sheet = await sharp({ create: { width, height: SHEET.height + SHEET.gap * 2, channels: 3, background: '#808080' } })
      .composite(tiles.map((input, i) => ({ input, left: SHEET.gap + i * (SHEET.width + SHEET.gap), top: SHEET.gap })))
      .png()
      .toBuffer()
    writeFileSync(join(dir, `${base.key}.png`), sheet)
    process.stdout.write(`${base.key}: ${jpegs.length} slides\n`)
  }
  process.stdout.write(`Saved to ${dir}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
