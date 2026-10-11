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
 *      link as the first comment -> settle the claim. A failure after the
 *      claim marks it failed and ends the run; nothing is retried.
 *
 * Posts per day: FB_POSTS_PER_DAY (default 4), spread over SLOTS cron slots.
 * A slot whose day is already full posts nothing.
 *
 * run() takes every outside thing as an argument, so the tests drive it with
 * a fake Graph client and an in-memory ledger.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { graphClient, GraphError } from './fb.mjs'
import { claim, settle, countDay, dayOf, keyOf, gitStore, memoryStore } from './ledger.mjs'
import { pickNext } from './pick.mjs'
import { SITE, commentOf, linkOf } from './site.mjs'

export const DEFAULT_PER_DAY = 4
export const MAX_PER_DAY = 12
export const SLOTS = 4
export const DRY_SAMPLES = 3
const GAP_MS = 90_000

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
  const count = manual ? int(env.COUNT, dry ? DRY_SAMPLES : 1) : Math.ceil(perDay / SLOTS)
  return { configured, enabled, askedDry, manual, perDay, dry, count }
}

function describe(pick, now) {
  const c = pick.candidate
  return [
    `### ${pick.mix.toUpperCase()} · ${pick.format} · ${c.title}`,
    `- Image: ${c.image}`,
    `- Link: ${linkOf(c.path)}`,
    `- Day: ${dayOf(now)}`,
    '',
    'Caption:',
    '',
    ...pick.caption.split('\n').map((l) => `> ${l}`),
    '',
    'First comment:',
    '',
    `> ${commentOf(c)}`,
    '',
  ].join('\n')
}

/**
 * @returns exit code (0 ok, 1 the owner must look)
 */
export async function run({ env, now = Date.now(), rng = Math.random, loadPools, store, makeGraph, summary, sleep, blockedTags = [] }) {
  const s = settingsOf(env)
  const out = []
  const flush = () => summary(`${out.join('\n')}\n`)
  out.push(`## Facebook Page poster: ${SITE.name}`, '')

  let graph = null
  if (!s.configured) {
    out.push('Facebook: **not configured** (the FB_PAGE_ID / FB_PAGE_TOKEN secrets are not set). Dry run only; nothing was sent to Facebook.', '')
  } else {
    try {
      graph = makeGraph({ pageId: env.FB_PAGE_ID, token: env.FB_PAGE_TOKEN })
      const name = await graph.pageName()
      out.push(`Facebook: token works for the Page **${name || '(no name)'}**.`, '')
    } catch (error) {
      const auth = error instanceof GraphError && error.isAuth
      out.push(
        auth
          ? `Facebook: **the Page token was refused** (${error.message}). Make a new long-lived Page token and update the FB_PAGE_TOKEN secret (docs/facebook-posting.md, step 3).`
          : `Facebook: the token check failed (${error.message}).`,
        '',
      )
      flush()
      return 1
    }
  }
  if (s.dry) {
    const why = !s.configured ? 'not configured' : !s.enabled ? 'the FB_POST_ENABLED variable is not true' : 'dry_run was asked for'
    out.push(`Mode: **DRY RUN** (${why}). Below is what it would post.`, '')
  } else out.push('Mode: **posting for real**.', '')

  let loaded
  try {
    loaded = await loadPools({ now })
  } catch (error) {
    out.push(`No data: ${error.message}. Nothing to post this run.`)
    flush()
    return 0
  }
  const { pools, source } = loaded
  out.push(`Data: ${source}. NEW pool ${pools.new.length}, OLD pool ${pools.old.length}.`, '')

  let ledger
  try {
    ledger = await store.read()
  } catch (error) {
    out.push(`The ledger could not be read (${error.message}). Nothing was posted.`)
    flush()
    return s.dry ? 0 : 1
  }
  // A dry run plays its claims against a copy, so the real ledger is untouched.
  const book = s.dry ? memoryStore(ledger.data) : store
  const day = dayOf(now)
  const done = countDay(ledger.data, day, SITE.key)
  const left = Math.max(0, s.perDay - done)
  const want = s.dry ? s.count : Math.min(s.count, left)
  out.push(`Today (${day}, US Eastern): ${done} of ${s.perDay} posts used.`, '')
  if (want === 0) {
    out.push('The daily count is reached. This slot is skipped.')
    flush()
    return 0
  }

  const skip = new Set()
  let posted = 0
  for (let attempt = 0; posted < want && attempt < want + 10; attempt += 1) {
    const { data } = await book.read()
    const history = (data.entries || []).filter((e) => e.page === SITE.key).sort((x, y) => x.at - y.at)
    const pick = pickNext({ pools, history, now, rng, skip, blockedTags })
    if (!pick) {
      out.push('Nothing left that fits the rules (30-day gap, format rotation, safe content).')
      break
    }
    const c = pick.candidate
    const entry = { key: keyOf(day, c.slug, SITE.key), day, slug: c.slug, title: c.title, page: SITE.key, mix: pick.mix, format: pick.format, at: now }
    const claimed = await claim(book, entry, now)
    if (!claimed.ok) {
      skip.add(c.slug)
      out.push(`Skipped ${c.title}: ${claimed.reason}.`, '')
      continue
    }
    out.push(describe(pick, now))
    if (s.dry) {
      await settle(book, entry.key, { status: 'dry' })
      posted += 1
      continue
    }

    let postId
    try {
      const result = c.image ? await graph.publishPhoto({ url: c.image, caption: pick.caption }) : await graph.publishText({ message: pick.caption })
      postId = result.postId
    } catch (error) {
      await settle(book, entry.key, { status: 'failed', error: error.message })
      out.push(`**Post failed** for ${c.title}: ${error.message}. Marked failed in the ledger; not retried.`)
      flush()
      return 1
    }
    try {
      const { commentId } = await graph.comment(postId, commentOf(c))
      await settle(book, entry.key, { status: 'posted', postId, commentId })
      out.push(`Posted: ${postId}, link comment ${commentId}.`, '')
    } catch (error) {
      await settle(book, entry.key, { status: 'posted', postId, commentError: error.message })
      out.push(`Posted ${postId}, but **the link comment failed**: ${error.message}. Add the link by hand on Facebook.`)
      flush()
      return 1
    }
    posted += 1
    if (posted < want) await sleep(GAP_MS)
  }
  flush()
  return 0
}

/** git with this repo's credentials; throws on a non-zero exit. */
const git = (args, input) => execFileSync('git', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })

async function main() {
  const { loadPools, BLOCKED_TAGS } = await import('./source.mjs')
  const summaryFile = process.env.GITHUB_STEP_SUMMARY
  const code = await run({
    env: process.env,
    loadPools,
    store: gitStore({ git }),
    makeGraph: graphClient,
    summary: (text) => (summaryFile ? appendFileSync(summaryFile, text) : process.stdout.write(text)),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    blockedTags: [...BLOCKED_TAGS],
  })
  if (summaryFile) console.log('Done; see the job summary.')
  process.exitCode = code
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
