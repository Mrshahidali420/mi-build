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
 *      link as the first comment -> settle the claim (send.mjs). A failure
 *      after the claim marks it failed and ends the run; nothing is retried.
 *
 * Posts per day: FB_POSTS_PER_DAY (default 4, never above MAX_PER_DAY). The
 * workflow runs every hour; a scheduled run sends at most one post, and only
 * while the day is behind the even pace (pace.mjs). A manual run ignores the
 * pace and sends `count` posts, still inside the daily cap.
 *
 * Kinds of post: the classic post (a cover and a caption) unless the repo
 * variable FB_POST_TYPES names template types (gate.mjs). The template code
 * (types/, render/) is loaded only when that variable names one.
 *
 * run() takes every outside thing as an argument, so the tests drive it with
 * a fake Graph client and an in-memory ledger.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { graphClient, GraphError } from './fb.mjs'
import { CLASSIC, enabledTypes, onlyClassic } from './gate.mjs'
import { resolveCover } from './image.mjs'
import { countDay, dayOf, gitStore, memoryStore } from './ledger.mjs'
import { isBehind, nextDueTime } from './pace.mjs'
import { planNext } from './plan.mjs'
import { classicStep, typedStep, STEP } from './send.mjs'
import { SITE } from './site.mjs'

export const DEFAULT_PER_DAY = 4
export const MAX_PER_DAY = 24
/** A scheduled (hourly) run never sends more than this. */
export const POSTS_PER_RUN = 1
export const DRY_SAMPLES = 3
const GAP_MS = 90_000
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
  const perDay = Math.min(int(env.FB_POSTS_PER_DAY, DEFAULT_PER_DAY), MAX_PER_DAY)
  const dry = !configured || !enabled || askedDry
  const count = manual ? int(env.COUNT, dry ? DRY_SAMPLES : 1) : POSTS_PER_RUN
  // A manual DRY run may name its own types, to look at a design before it is switched on.
  // A run that posts for real reads the repo variable alone.
  const typesValue = String((manual && askedDry && env.TYPES) || env.FB_POST_TYPES || '').trim()
  return { configured, enabled, askedDry, manual, perDay, dry, count, typesValue }
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
    throw new Error(
      auth
        ? `Facebook: **the Page token was refused** (${error.message}). Make a new long-lived Page token and update the FB_PAGE_TOKEN secret (docs/facebook-posting.md, step 3).`
        : `Facebook: the token check failed (${error.message}).`,
    )
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

/**
 * @returns exit code (0 ok, 1 the owner must look)
 */
export async function run({ env, now = Date.now(), rng = Math.random, loadPools, store, makeGraph, summary, sleep, blockedTags = [], resolveImage = resolveCover, loadTypes = defaultTypes, render = defaultRender, preview = null }) {
  const s = settingsOf(env)
  const out = [`## Facebook Page poster: ${SITE.name}`, '']
  const end = (code, line) => {
    if (line) out.push(line)
    summary(`${out.join('\n')}\n`)
    return code
  }

  let graph
  try {
    graph = await openGraph(s, env, makeGraph, out)
  } catch (error) {
    return end(1, `${error.message}\n`)
  }
  if (s.dry) {
    const why = !s.configured ? 'not configured' : !s.enabled ? 'the FB_POST_ENABLED variable is not true' : 'dry_run was asked for'
    out.push(`Mode: **DRY RUN** (${why}). Below is what it would post.`, '')
  } else out.push('Mode: **posting for real**.', '')

  // The ledger and the pace come first: a run with nothing due never loads the data.
  let ledger
  try {
    ledger = await store.read()
  } catch (error) {
    return end(s.dry ? 0 : 1, `The ledger could not be read (${error.message}). Nothing was posted.`)
  }
  // A dry run plays its claims against a copy, so the real ledger is untouched.
  const book = s.dry ? memoryStore(ledger.data) : store
  const day = dayOf(now)
  const done = countDay(ledger.data, day, SITE.key)
  const left = Math.max(0, s.perDay - done)
  const want = s.dry ? s.count : Math.min(s.count, left)
  out.push(`Today (${day}, US Eastern): ${done} of ${s.perDay} posts used.`, '')
  if (want === 0) return end(0, 'The daily count is reached. This run is skipped.')
  if (!s.manual && !isBehind(done, now, s.perDay)) return end(0, `On pace: the next post is due at about ${nextDueTime(done, s.perDay)} ET. This run is skipped.`)

  const kinds = await kindsOf(s, loadTypes, out)
  let loaded
  try {
    loaded = await loadPools({ now })
  } catch (error) {
    return end(0, `No data: ${error.message}. Nothing to post this run.`)
  }
  const { pools, source, data } = loaded
  const todayLine = pools.today ? `, episodes still to air today ${pools.today.length}` : ''
  out.push(`Data: ${source}. NEW pool ${pools.new.length}, OLD pool ${pools.old.length}${todayLine}.`, '')

  const failed = await sendPosts({ s, graph, book, kinds, pools, data, now, day, rng, blockedTags, out, resolveImage, render, preview, sleep, want, left })
  return end(failed ? 1 : 0)
}

/**
 * Send up to `want` posts, one at a time. An item that is taken or cannot be
 * drawn is skipped and another is tried, a few times at most.
 * @returns true when a post failed and the owner must look
 */
async function sendPosts({ s, book, kinds, sleep, want, left, out, ...ctx }) {
  const skip = new Set()
  let posted = 0
  for (let attempt = 0; posted < want && attempt < want + SPARE_TRIES; attempt += 1) {
    const history = ((await book.read()).data.entries || []).filter((e) => e.page === SITE.key).sort((x, y) => x.at - y.at)
    const step = await oneStep({ ...ctx, s, book, kinds, out, history, skip, slotsLeft: left - posted })
    if (step === STEP.failed) return true
    if (step === STEP.none) {
      out.push('Nothing left that fits the rules (the gaps between repeats, format rotation, safe content).')
      return false
    }
    if (step !== STEP.posted) continue
    posted += 1
    if (!s.dry && posted < want) await sleep(GAP_MS)
  }
  return false
}

/** Choose the next post and send it. */
async function oneStep({ kinds, data, pools, resolveImage, render, preview, ...ctx }) {
  const { history, now, rng, skip, slotsLeft, blockedTags } = ctx
  const plan = onlyClassic(kinds) ? { classic: true } : planNext({ kinds, data, history, now, rng, skip, slotsLeft, blockedTags })
  if (!plan) return STEP.none
  if (!plan.classic) return typedStep({ ...ctx, plan, render, preview })
  const step = await classicStep({ ...ctx, pools, resolveImage })
  if (step !== STEP.none || onlyClassic(kinds)) return step
  // The classic post has nothing left; the other kinds take the turn.
  skip.add(CLASSIC)
  return STEP.skipped
}

const defaultTypes = async () => (await import('./types/index.mjs')).TYPES

async function defaultRender(type, post) {
  const [{ renderPost }, { THEME }] = await Promise.all([import('./render/engine.mjs'), import('./theme.mjs')])
  return renderPost(type, post, { theme: THEME })
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
  const code = await run({
    env: process.env,
    loadPools,
    store: gitStore({ git }),
    makeGraph: graphClient,
    // The summary goes to the job page and to the log (secrets are masked there).
    summary: (text) => {
      if (summaryFile) appendFileSync(summaryFile, text)
      process.stdout.write(text)
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    blockedTags: [...BLOCKED_TAGS],
    preview: previewTo(process.env.FB_PREVIEW_DIR),
  })
  process.exitCode = code
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
