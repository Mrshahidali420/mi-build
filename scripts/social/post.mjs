/**
 * The Facebook Page poster: one run of .github/workflows/fb-post.yml.
 *
 *   1. Not configured (no FB_PAGE_ID / FB_PAGE_TOKEN secret): say so, dry run,
 *      exit 0. Never a red run for a missing setup.
 *   2. Configured: check the token (GET /{page-id}?fields=name). A token
 *      error fails the run with a plain line in the job summary.
 *   3. Real posting only when the repo variable FB_POST_ENABLED is 'true' and
 *      the manual run did not ask for a dry run. Otherwise the summary shows
 *      what it WOULD post.
 *   4. Each post: claim in the ledger (pushed) -> photo with caption -> the
 *      link as the first comment -> settle the claim (send.mjs).
 *
 * Three kinds of run (settingsOf, `mode`):
 *   chain    the normal one. It loops for hours: post, wait, post (chain.mjs),
 *            then asks the workflow to start its successor
 *   manual   a run started by hand with a `count`: that many posts, the gap
 *            and the cap kept, the even pace ignored. It never starts a chain
 *   dry      shows what it would post and touches nothing. Never a chain
 *
 * The pace (pace.mjs): never closer than FB_MIN_GAP_MINUTES (5 at least),
 * never more than FB_POSTS_PER_DAY in any 24 hours (24 when unset, 288 at
 * most), spread evenly. Facebook's limit signals are written to the ledger
 * and can lower the cap (limits.mjs); nothing raises it but the owner.
 *
 * Reels (types marked `reel`) are gated like every type, limited to
 * FB_REELS_PER_DAY in the rolling day (3 unless set, 10 at most). In the chain
 * they have their own lane (28 Oct 2026): out of the posts' cap, spread
 * evenly, never within five minutes of another post (chain.mjs, pace.mjs).
 *
 * Shares of the sister Page's posts (share.mjs) are off unless FB_SHARES_PER_DAY
 * (4 at most) and FB_SHARE_FROM are set; they too count inside the cap and
 * never run two in a row.
 *
 * Kinds of post: the classic post (a cover and a caption) unless the repo
 * variable FB_POST_TYPES names template types (gate.mjs). The template code
 * (types/, render/) is loaded only when that variable names one.
 *
 * run() takes every outside thing as an argument, so the tests drive it with
 * a fake Graph client, a fake clock and an in-memory ledger.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { attemptOnce } from './attempt.mjs'
import { runChain } from './chain.mjs'
import { graphClient, GraphError } from './fb.mjs'
import { igClient, igSettingsOf } from './ig.mjs'
import { CLASSIC, enabledTypes } from './gate.mjs'
import { resolveCover } from './image.mjs'
import { gitStore, memoryStore } from './ledger.mjs'
import { effectiveCap, saveHealth, withHalt } from './limits.mjs'
import { countedEntries, gapMinutesOf, nextWait, perDayOf, postLane, reelLane, reelsPerDayOf, rollingCount, DEFAULT_PER_DAY, MAX_PER_DAY } from './pace.mjs'
import { STEP } from './send.mjs'
import { shareSettingsOf } from './share.mjs'
import { withBirthdays } from './birthdays.mjs'
import { withExtras } from './extras.mjs'
import { SITE, affiliateOn } from './site.mjs'
import { timeOf } from './when.mjs'

export { DEFAULT_PER_DAY, MAX_PER_DAY }
export const DRY_SAMPLES = 3
/** A chain run lasts this long by default: under GitHub's six-hour job limit, with room to finish a post. */
export const DEFAULT_CHAIN_MINUTES = 330
const MAX_CHAIN_MINUTES = 340
/** Extra tries a run gets when an item turns out to be taken or cannot be drawn. */
const SPARE_TRIES = 10

const int = (v, fallback) => {
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function settingsOf(env) {
  const configured = Boolean(env.FB_PAGE_ID && env.FB_PAGE_TOKEN)
  const enabled = env.FB_POST_ENABLED === 'true'
  const askedDry = env.DRY_RUN === 'true'
  const manual = env.EVENT === 'workflow_dispatch'
  const dry = !configured || !enabled || askedDry
  const asked = int(env.COUNT, 0)
  // A run that posts for real is the chain, unless a run started by hand says how many posts it wants.
  const mode = dry ? 'dry' : manual && asked ? 'manual' : 'chain'
  const count = asked || (dry ? DRY_SAMPLES : 1)
  // A manual DRY run may name its own types, to look at a design before it is switched on.
  // A run that posts for real reads the repo variable alone.
  const typesValue = String((manual && askedDry && env.TYPES) || env.FB_POST_TYPES || '').trim()
  return {
    configured,
    enabled,
    askedDry,
    manual,
    dry,
    mode,
    count,
    typesValue,
    perDay: perDayOf(env.FB_POSTS_PER_DAY),
    gapMinutes: gapMinutesOf(env.FB_MIN_GAP_MINUTES),
    reelsPerDay: reelsPerDayOf(env.FB_REELS_PER_DAY),
    share: shareSettingsOf(env),
    chainMinutes: Math.min(int(env.FB_CHAIN_MINUTES, DEFAULT_CHAIN_MINUTES), MAX_CHAIN_MINUTES),
    // 'watch' when the backstop cron started this run; it must not restart a halted chain.
    startedBy: env.STARTED_BY || 'hand',
    affiliate: affiliateOn(env),
  }
}

/** The Graph client with a working token, or null for a dry run without one. Throws a line for the summary. */
async function openGraph(s, env, makeGraph, out) {
  if (!s.configured) {
    out.push('Facebook: **not configured** (the FB_PAGE_ID / FB_PAGE_TOKEN secrets are not set). Dry run only; nothing was sent to Facebook.', '')
    return null
  }
  try {
    const graph = makeGraph({ pageId: env.FB_PAGE_ID, token: env.FB_PAGE_TOKEN })
    const name = await graph.pageName()
    out.push(`Facebook: token works for the Page **${name || '(no name)'}**.`, '')
    return graph
  } catch (error) {
    const auth = error instanceof GraphError && error.isAuth
    throw Object.assign(
      new Error(
        auth
          ? `Facebook: **the Page token was refused** (${error.message}). Make a new long-lived Page token and update the FB_PAGE_TOKEN secret (docs/facebook-posting.md, step 3).`
          : `Facebook: the token check failed (${error.message}).`,
      ),
      { auth },
    )
  }
}

/**
 * Instagram for this run: { settings, client, off } or null when it is off.
 * A missing setup or a refused token is said and Instagram sits the run out;
 * the Facebook posts are never held up by it.
 */
async function openInstagram(s, env, makeInstagram, out) {
  const settings = igSettingsOf(env)
  if (!settings.enabled) return null
  if (!settings.configured) {
    out.push('Instagram: **not configured** (needs the FB_PAGE_ID or IG_USER_ID secret, and a token). Facebook only.', '')
    return null
  }
  try {
    const client = makeInstagram({ userId: settings.userId, pageId: settings.pageId, token: settings.token })
    const { id, username } = await client.account()
    const only = settings.types ? `, only ${[...settings.types].join(', ')}` : ''
    const check = settings.checkOnly ? ' Check only: nothing is posted to Instagram.' : ''
    out.push(`Instagram: token works for **@${username || '(no name)'}** (account ${id}). Up to ${settings.perDay} posts in any 24 hours${only}.${check}`, '')
    return { settings, client, off: null }
  } catch (error) {
    out.push(`Instagram: the account check failed (${error.message}). Facebook only this run.`, '')
    return null
  }
}

/** The switched-on kinds: type objects and the string 'classic', in the owner's order. */
async function kindsOf(s, loadTypes, out) {
  if (!s.typesValue) return [CLASSIC]
  try {
    const all = await loadTypes()
    const { types, unknown } = enabledTypes(s.typesValue, all.map((t) => t.key))
    if (unknown.length) out.push(`Post types not known to this site, ignored: ${unknown.join(', ')}.`, '')
    out.push(`Post types switched on: ${types.join(', ')}.`, '')
    return types.map((name) => (name === CLASSIC ? CLASSIC : all.find((t) => t.key === name)))
  } catch (error) {
    out.push(`The template post types could not be loaded (${error.message}). Classic posts only this run.`, '')
    return [CLASSIC]
  }
}

/** What the run says about shares of the sister Page's posts. */
function shareLine(share) {
  if (share.on) return `Shares: up to ${share.perDay} in any 24 hours (inside the cap) of the posts of ${share.from}${share.name ? ` (${share.name})` : ''}.`
  return `Shares: off${share.perDay && !share.from ? ' (FB_SHARE_FROM is not set to a repo)' : ''}.`
}

/** The lines that say where the rolling day stands. */
function paceLines(s, health, cap, used) {
  const cut = cap < s.perDay ? ` The cap of ${s.perDay} is cut to ${cap} after a block signal; change FB_POSTS_PER_DAY by hand to lift it.` : ''
  const peak = health.peak ? ` Highest usage in the last 24 hours: ${health.peak.pct}% (${health.peak.source}).` : ''
  const signals = (health.signals || []).length ? ` Limit signals on record: ${health.signals.length}, the last one "${health.signals.at(-1).note}".` : ' No limit signal on record.'
  return [`Last 24 hours: ${used} of ${cap} posts used. Minimum gap: ${s.gapMinutes} minutes.${cut}`, '', `Limit watch:${signals}${peak}`, '']
}

/**
 * @param clock () => ms; a test passes its own, or a fixed `now`
 * @param output (name, value) => void; the workflow reads `chain` to start the next run
 * @returns exit code (0 ok, 1 the owner must look)
 */
export async function run({ fetch = globalThis.fetch, env, now, clock = now === undefined ? Date.now : () => now, rng = Math.random, loadPools, store, makeGraph, makeInstagram = igClient, summary, sleep, blockedTags = [], resolveImage = resolveCover, loadTypes = defaultTypes, render = defaultRender, preview = null, output = () => {} }) {
  const s = settingsOf(env)
  const out = [`## Facebook Page poster: ${SITE.name}`, '']
  const flush = () => out.length && summary(`${out.splice(0).join('\n')}\n`)
  const end = (code, line) => {
    if (line) out.push(line)
    flush()
    return code
  }
  output('chain', 'stop')

  let graph
  try {
    graph = await openGraph(s, env, makeGraph, out)
  } catch (error) {
    if (error.auth && s.mode === 'chain') await saveHealth(store, (h) => withHalt(h, 'the Page token was refused', clock()), 'Chain halted').catch(() => null)
    return end(1, `${error.message}\n`)
  }
  if (s.dry) {
    const why = !s.configured ? 'not configured' : !s.enabled ? 'the FB_POST_ENABLED variable is not true' : 'dry_run was asked for'
    out.push(`Mode: **DRY RUN** (${why}). Below is what it would post.`, '')
  } else out.push(`Mode: **posting for real** (${s.mode === 'chain' ? 'the chain' : `a manual run of ${s.count}`}).`, '')

  let ledger
  try {
    ledger = await store.read()
  } catch (error) {
    return end(s.dry ? 0 : 1, `The ledger could not be read (${error.message}). Nothing was posted.`)
  }
  // A dry run plays its claims against a copy, so the real ledger is untouched.
  const book = s.dry ? memoryStore(ledger.data) : store
  const health = ledger.data.health || {}
  const cap = effectiveCap(health, s.perDay)
  const counted = countedEntries(ledger.data, SITE.key)
  const used = rollingCount(postLane(counted), clock())
  out.push(...paceLines(s, health, cap, used))
  out.push(`Reels: ${rollingCount(reelLane(counted), clock())} of ${s.reelsPerDay} in the last 24 hours, on their own budget (not in the posts' cap), never within 5 minutes of another post.`, '')
  out.push(shareLine(s.share), '')
  out.push(`Amazon line in the first comment: ${s.affiliate ? 'on' : 'off (the FB_AFFILIATE_COMMENT variable is not true)'}.`, '')

  const ig = await openInstagram(s, env, makeInstagram, out)
  const kinds = await kindsOf(s, loadTypes, out)
  // A kind that wants today's birthdays (types/birthday-card.mjs) gets them with the data; no other run asks.
  const say = (line) => out.push(line, '')
  const base = { fetch, s, graph, ig, book, kinds, rng, blockedTags, out, flush, resolveImage, render, preview, clock, sleep, loadPools: withExtras(withBirthdays(loadPools, kinds, { book, fetch, say }), kinds, { book, fetch, say }) }
  if (s.mode === 'chain') {
    if (health.halted && s.startedBy === 'watch') return end(0, `The chain was halted (${health.halted.why}). It is started by hand once that is fixed; the watch job does not restart it.`)
    if (health.halted) await saveHealth(book, (h) => withHalt(h, null, clock()), 'Chain restarted')
    const result = await runChain(base)
    output('chain', result.next ? 'next' : 'stop')
    return end(result.code)
  }
  return end((await runOnce(base, { cap, used, health })) ? 1 : 0)
}

/**
 * A dry run or a manual run: up to `count` posts, then it ends.
 * @returns true when a post failed and the owner must look
 */
async function runOnce(base, { cap, used, health }) {
  const { s, out, clock, loadPools } = base
  const left = Math.max(0, cap - used)
  const want = s.dry ? s.count : Math.min(s.count, left)
  if (!s.dry && (health.blockedUntil || 0) > clock()) return out.push(`Facebook signalled a block: no posts until about ${timeOf(health.blockedUntil)} ET. This run is skipped.`) && false
  if (want === 0) return out.push('The cap for the last 24 hours is reached. This run is skipped.') && false
  let loaded
  try {
    loaded = await loadPools({ now: clock() })
  } catch (error) {
    return out.push(`No data: ${error.message}. Nothing to post this run.`) && false
  }
  const todayLine = loaded.pools.today ? `, episodes still to air today ${loaded.pools.today.length}` : ''
  out.push(`Data: ${loaded.source}. NEW pool ${loaded.pools.new.length}, OLD pool ${loaded.pools.old.length}${todayLine}.`, '')
  return sendPosts(base, { loaded, want, left, cap })
}

/**
 * Send up to `want` posts, one at a time. An item that is taken or cannot be
 * drawn is skipped and another is tried, a few times at most. A real post
 * first waits out the minimum gap since the last one in the ledger.
 */
async function sendPosts(base, { loaded, want, left, cap }) {
  const { s, book, out, clock, sleep } = base
  const skip = new Set()
  let posted = 0
  for (let attempt = 0; posted < want && attempt < want + SPARE_TRIES; attempt += 1) {
    if (!s.dry) {
      const counted = countedEntries((await book.read()).data, SITE.key)
      const wait = nextWait({ entries: postLane(counted), others: reelLane(counted), now: clock(), cap, gapMinutes: s.gapMinutes, even: false })
      if (wait.why === 'cap') return out.push('The cap for the last 24 hours is reached.') && false
      if (wait.ms > 0) await sleep(wait.ms)
    }
    const step = await attemptOnce(base, { loaded, skip, slotsLeft: left - posted })
    if (step === STEP.failed) return true
    if (step === STEP.none) return out.push('Nothing left that fits the rules (the gaps between repeats, format rotation, safe content).') && false
    if (step === STEP.posted) posted += 1
  }
  return false
}

/** Every kind the site has: the picture types, and the reels (off, like all of them, until named). */
const defaultTypes = async () => (await import('./types/index.mjs')).KINDS

async function defaultRender(type, post, { avoidTrack = null, words, swipe = false } = {}) {
  const { THEME } = await import('./theme.mjs')
  // The Instagram swipe post of a list post: the slides of the reel type made from it, or null when it has none.
  if (swipe) {
    const reel = (await import('./types/index.mjs')).REELS.find((r) => r.carouselOf === type.key && r.carousel)
    return reel ? { jpegs: await (await import('./reel/engine.mjs')).renderCarousel(reel, reel.fromPost(post), { theme: THEME }) } : null
  }
  if (type.reel) return (await import('./reel/engine.mjs')).renderReel(type, post, { theme: THEME, avoidTrack })
  return (await import('./render/engine.mjs')).renderPost(type, post, { theme: THEME, words })
}

/** git with this repo's credentials; throws on a non-zero exit. */
const git = (args, input) => execFileSync('git', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })

/** A dry run's pictures go to FB_PREVIEW_DIR when it is set (the workflow uploads that folder). */
function previewTo(dir) {
  if (!dir) return null
  return (name, bytes) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, name), bytes)
  }
}

async function main() {
  const { loadPools, BLOCKED_TAGS } = await import('./source.mjs')
  const summaryFile = process.env.GITHUB_STEP_SUMMARY
  const outputFile = process.env.GITHUB_OUTPUT
  const outputs = new Map()
  const code = await run({
    env: process.env,
    loadPools,
    store: gitStore({ git }),
    makeGraph: graphClient,
    // The summary goes to the job page and to the log (secrets are masked there), line by line as the chain runs.
    summary: (text) => {
      if (summaryFile) appendFileSync(summaryFile, text)
      process.stdout.write(text)
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    blockedTags: [...BLOCKED_TAGS],
    preview: previewTo(process.env.FB_PREVIEW_DIR),
    output: (name, value) => outputs.set(name, value),
  })
  // Written once, at the end: only a run that finished healthy hands over to a successor.
  if (outputFile) for (const [name, value] of outputs) appendFileSync(outputFile, `${name}=${code === 0 ? value : 'stop'}\n`)
  process.exitCode = code
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
