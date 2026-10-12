/**
 * Sample images for every post type, for the owner to look at before a type
 * is switched on (FB_POST_TYPES). Nothing is posted and no ledger is read.
 *
 *   node scripts/social/samples.mjs --out <folder> [--per 2] [--types a,b] [--long]
 *
 * --long takes the posts with the longest names instead, to check that no
 * image overflows.
 *
 * Run it from the site's folder. It reads the same data the poster reads
 * (R2 or the Actions cache on the runner, the local data/ folder on a PC),
 * finds real posts for each type and writes <type>.png, <type>-2.png, ...
 * plus captions.md with every wording of each sample's caption and the first
 * comment.
 *
 * A list type has one post at a time (next week, next month), so the second
 * sample of such a type is the same type looked at from a later day.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadBirthdays } from './birthdays.mjs'
import { memoryStore } from './ledger.mjs'
import { captionFor } from './plan.mjs'
import { commentFor } from './site.mjs'
import { DAY_MS } from './when.mjs'

/** Other days a type is looked at from, when today alone gives too few posts. */
const LOOK_DAYS = [0, 7, 14, 21, 31, 62, -7, -14, -21]
const DEFAULT_PER = 2
/** Each type starts this much further down its list, so the samples show different titles. */
const TYPE_STEP = 4

export function argsOf(argv) {
  const read = (name, fallback) => {
    const at = argv.indexOf(`--${name}`)
    return at !== -1 && argv[at + 1] ? argv[at + 1] : fallback
  }
  return { out: read('out', 'social-samples'), per: Math.max(1, Number.parseInt(read('per', DEFAULT_PER), 10) || DEFAULT_PER), only: read('types', '').split(',').filter(Boolean), long: argv.includes('--long') }
}

/** How much text a post puts on its image (the longest name wins the --long check). */
const lengthOf = (post) => Math.max(0, ...[post.title, post.name, post.view?.title, post.view?.name].filter(Boolean).map((s) => String(s).length))

/** Spread picks across a list so two samples are not neighbours. */
function spread(posts, per, offset = 0) {
  if (posts.length <= per) return posts
  const step = Math.max(1, Math.min(Math.floor(posts.length / per), 7))
  return Array.from({ length: per }, (_, i) => posts[(offset + i * step) % posts.length])
}

/**
 * Up to `per` posts of one type about different things.
 * @param loadData async (now) -> the data the type reads on that day
 * @param offset how far down the type's list the first sample is taken from
 */
export async function samplePosts(type, { per, now, loadData, offset = 0, long = false }) {
  const out = []
  const seen = new Set()
  for (const days of LOOK_DAYS) {
    if (out.length >= per) break
    const at = now + days * DAY_MS
    const found = type.find(await loadData(at), { now: at }).filter((p) => !seen.has(p.item) && !seen.has(p.title || p.item))
    const posts = long ? [...found].sort((x, y) => lengthOf(y) - lengthOf(x)).slice(0, per) : found
    // A type may name the posts that show its range (one site and many sites, say).
    const chosen = !long && type.samples ? type.samples(found).filter(Boolean) : []
    for (const post of chosen.length ? chosen.slice(0, per - out.length) : spread(posts, per - out.length, long ? 0 : offset)) {
      if (seen.has(post.item) || (post.title && seen.has(post.title))) continue
      seen.add(post.item)
      if (post.title) seen.add(post.title)
      out.push({ post, now: at })
    }
  }
  return out.slice(0, per)
}

const captionsOf = (type, post, blockedTags) =>
  type.captions.map((_, turn) => captionFor({ ...type, captions: [type.captions[turn]] }, post, 0, blockedTags)?.caption || '(this wording does not fit this post)')

async function main() {
  const { out, per, only, long } = argsOf(process.argv.slice(2))
  const [{ TYPES }, { THEME }, { renderPost }, source] = await Promise.all([import('./types/index.mjs'), import('./theme.mjs'), import('./render/engine.mjs'), import('./source.mjs')])
  const now = Date.now()
  const dataAt = await source.dataLoader()
  const cache = new Map()
  // Today's birthdays are asked for once, like a run does, and only for a type that wants them.
  const wants = TYPES.find((type) => type.birthdays && (!only.length || only.includes(type.key)))
  const birthdays = wants ? await loadBirthdays({ book: memoryStore(), now, choose: wants.birthdays(await dataAt(now)), say: (line) => process.stdout.write(`${line}\n`) }) : null
  const loadData = async (at) => {
    if (!cache.has(at)) cache.set(at, { ...(await dataAt(at)), birthdays })
    return cache.get(at)
  }
  const dir = resolve(out)
  mkdirSync(dir, { recursive: true })
  const notes = [`# ${THEME.name}: sample posts`, '']
  const lines = []
  for (const [at, type] of TYPES.entries()) {
    if (only.length && !only.includes(type.key)) continue
    const samples = await samplePosts(type, { per, now, loadData, offset: at * TYPE_STEP, long })
    if (!samples.length) {
      lines.push(`${type.key}: no data for this type right now`)
      continue
    }
    for (const [i, { post }] of samples.entries()) {
      const name = `${type.key}${i ? `-${i + 1}` : ''}.png`
      // One picture that will not load must not stop the other samples.
      const made = await renderPost(type, post, { theme: THEME }).catch((error) => ({ error }))
      if (made.error) {
        lines.push(`${type.key}: ${name} could not be drawn (${post.name || post.title || post.item}: ${made.error.message})`)
        continue
      }
      writeFileSync(join(dir, name), made.png)
      notes.push(`## ${type.name} (${name})`, '', ...captionsOf(type, post, [...(source.BLOCKED_TAGS || [])]).flatMap((c, n) => [`Wording ${n + 1}:`, '', ...c.split('\n').map((l) => `> ${l}`), '']), 'First comment:', '', ...commentFor(post).split('\n').map((l) => `> ${l}`), '', ...(post.shop ? ['With FB_AFFILIATE_COMMENT set to true, a second line is added:', '', `> ${commentFor(post, { affiliate: true }).split('\n')[1]}`, ''] : ['No Amazon line for this one: the site has no product picked for it.', '']))
      lines.push(`${type.key}: ${name} (${post.title || post.item})`)
    }
  }
  writeFileSync(join(dir, 'captions.md'), `${notes.join('\n')}\n`)
  process.stdout.write(`${lines.join('\n')}\nSaved to ${dir}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
