/**
 * Shares: this Page shares a post the sister Page made (owner decision,
 * 27 Oct 2026: "share each other's posts, 2 or 3 a day").
 *
 * The two Pages cannot read each other through the Graph API (no Page Public
 * Content Access), so the sister Page's posts come from its own public
 * ledger: ledger.json on the `social-state` branch of the repo named in
 * FB_SHARE_FROM, read from raw.githubusercontent.com.
 *
 *   FB_SHARES_PER_DAY   shares in any 24 hours, counted INSIDE the overall
 *                       cap like reels. Unset or 0 = off, 4 at most
 *   FB_SHARE_FROM       the sister repo, owner/name. Unset = off
 *   FB_SHARE_FROM_NAME  the sister Page's name for the message (optional)
 *
 * The rules (shareOpen): never two shares in a row, at most the daily number
 * in the rolling day, spread out (no closer than a day shared by one more
 * than that number), and none for SHARE_REST_MS after one that failed.
 *
 * What is shared (pickShare): a post of the other Page that really went out
 * (it has a Facebook post id), between 2 and 72 hours old, that this Page has
 * not shared before. The newest first, another kind than the last share when
 * one is there.
 *
 * A share is POST /{page-id}/feed with the post's public address as `link`
 * and one short line as `message`. No first comment, no Amazon line. It is
 * claimed in the ledger first like any post; a failed share stays `failed`
 * and is never tried again. A sister ledger that cannot be read, or holds
 * nothing to share, only means no share this time: the normal post takes
 * the turn.
 */
import { claim, keyOf, settle, KEEP_DAYS, LEDGER_BRANCH, LEDGER_FILE } from './ledger.mjs'
import { DAY_MS, HOUR_MS } from './pace.mjs'
import { STEP } from './send.mjs'
import { SITE } from './site.mjs'

/** The ledger kind of a share, and its key in a run's `skip` set. */
export const SHARE = 'share'
export const MAX_SHARES_PER_DAY = 4
/** A sister post is shared once it is this old, and no longer once it is older than this. */
export const SHARE_MIN_AGE_MS = 2 * HOUR_MS
export const SHARE_MAX_AGE_MS = 72 * HOUR_MS
/** After a share that Facebook refused, no share is tried for this long. */
export const SHARE_REST_MS = 6 * HOUR_MS
export const FETCH_TIMEOUT_MS = 15_000
const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/

/** FB_SHARES_PER_DAY as a number: 0 (off) when unset or not a number, never over 4. */
export function sharesPerDayOf(value) {
  const n = Number.parseInt(String(value ?? '').trim(), 10)
  return Number.isFinite(n) ? Math.min(MAX_SHARES_PER_DAY, Math.max(0, n)) : 0
}

/** FB_SHARE_FROM as owner/name, or null when it is unset or not a repo name. */
export function shareFromOf(value) {
  const repo = String(value ?? '').trim()
  return REPO.test(repo) ? repo : null
}

/** The share settings of a run: { perDay, from, name, on }. */
export function shareSettingsOf(env) {
  const perDay = sharesPerDayOf(env.FB_SHARES_PER_DAY)
  const from = shareFromOf(env.FB_SHARE_FROM)
  const name = String(env.FB_SHARE_FROM_NAME || '').trim().slice(0, 60) || null
  return { perDay, from, name, on: perDay > 0 && Boolean(from) }
}

export const ledgerUrlOf = (repo) => `https://raw.githubusercontent.com/${repo}/${LEDGER_BRANCH}/${LEDGER_FILE}`

/**
 * May a share take this turn?
 * @param history this Page's entries, oldest first (attempt.mjs historyOf)
 */
export function shareOpen(history, now, perDay) {
  if (perDay <= 0 || history.at(-1)?.share) return false
  const shares = history.filter((e) => e.share)
  if (shares.filter((e) => e.at > now - DAY_MS).length >= perDay) return false
  const last = shares.at(-1)
  if (!last) return true
  if (last.status === 'failed' && last.at > now - SHARE_REST_MS) return false
  return last.at <= now - DAY_MS / (perDay + 1)
}

/** The public address of a post from its Graph id ({page-id}_{post-id}, or a reel's video id). */
export function permalinkOf(postId, { reel = false } = {}) {
  const id = String(postId ?? '').trim()
  const pair = /^(\d+)_(\d+)$/.exec(id)
  if (pair) return `https://www.facebook.com/${pair[1]}/posts/${pair[2]}`
  if (/^\d+$/.test(id)) return reel ? `https://www.facebook.com/reel/${id}` : `https://www.facebook.com/${id}`
  return null
}

/**
 * The sister post to share, or null.
 * @param ledger the sister repo's ledger (anything: a broken one gives null)
 * @param history this Page's entries; its shares say what was shared before
 */
export function pickShare({ ledger, history = [], now, ownPage = SITE.key }) {
  const entries = Array.isArray(ledger?.entries) ? ledger.entries : []
  const taken = new Set(history.filter((e) => e.share && e.sharedFrom).map((e) => String(e.sharedFrom)))
  const fresh = entries
    .filter((e) => e && typeof e === 'object' && e.status === 'posted' && e.postId && !e.share && e.page !== ownPage)
    .filter((e) => Number.isFinite(e.at) && e.at <= now - SHARE_MIN_AGE_MS && e.at >= now - SHARE_MAX_AGE_MS)
    .filter((e) => !taken.has(String(e.postId)) && permalinkOf(e.postId, e))
    .sort((x, y) => y.at - x.at)
  const lastFormat = history.findLast((e) => e.share)?.sourceFormat
  return fresh.find((e) => e.format !== lastFormat) || fresh[0] || null
}

/** The sister repo's ledger. Throws a short reason when it cannot be had in time. */
export async function fetchLedger(repo, { fetch = globalThis.fetch, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  let res
  try {
    res = await fetch(ledgerUrlOf(repo), { signal: AbortSignal.timeout(timeoutMs), headers: { 'cache-control': 'no-cache' } })
  } catch (error) {
    throw new Error(error?.name === 'TimeoutError' ? `no answer in ${Math.round(timeoutMs / 1000)} s` : `network error: ${error?.message || error}`)
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  let data
  try {
    data = await res.json()
  } catch {
    throw new Error('not JSON')
  }
  if (!Array.isArray(data?.entries)) throw new Error('no list of posts in it')
  return data
}

/** The one line that goes with a share, taking turns. */
const MESSAGES = [
  (name) => `New on our sister Page${name ? `, ${name}` : ''}:`,
  (name) => `Worth a look from our sister Page${name ? `, ${name}` : ''}:`,
  (name) => `Seen this yet? From our sister Page${name ? `, ${name}` : ''}:`,
  (name) => `In case you missed it, from our sister Page${name ? `, ${name}` : ''}:`,
]

export const shareMessage = (turn, name = null) => MESSAGES[Math.abs(turn) % MESSAGES.length](name)

/** The ledger entry of a share. Its `type` and `item` keep the same sister post from ever being shared twice. */
export function shareEntry({ source, link, message, repo }, day, now) {
  const postId = String(source.postId)
  const slug = `${SHARE}:${postId}`
  return {
    share: true,
    key: keyOf(day, slug, SITE.key),
    day,
    slug,
    // No title: a share must not hold this Page's own posts about that title back.
    title: null,
    page: SITE.key,
    mix: SHARE,
    format: SHARE,
    type: SHARE,
    item: postId,
    gapDays: KEEP_DAYS,
    titleGap: false,
    sharedFrom: postId,
    sharedPage: source.page || null,
    sharedRepo: repo,
    sourceTitle: source.title || null,
    sourceFormat: source.format || null,
    link,
    message,
    at: now,
  }
}

/**
 * One share. Returns STEP.none when there is nothing to share (the normal post
 * then takes the turn), STEP.posted, or STEP.failed (the error is marked
 * `share` so the chain treats it like a failed reel).
 */
export async function shareStep({ s, graph, book, history, now, day, out, onError, fetch = globalThis.fetch }) {
  const { from, name } = s.share
  const none = (why) => {
    out.push(`No share this time: ${why}.`, '')
    return STEP.none
  }
  let ledger
  try {
    ledger = await fetchLedger(from, { fetch })
  } catch (error) {
    return none(`the ledger of ${from} could not be read (${error.message})`)
  }
  const source = pickShare({ ledger, history, now })
  if (!source) return none(`${from} has no post between 2 and 72 hours old that this Page has not shared`)
  const link = permalinkOf(source.postId, source)
  const message = shareMessage(history.filter((e) => e.share).length, name)
  const entry = shareEntry({ source, link, message, repo: from }, day, now)
  const claimed = await claim(book, entry, now)
  if (!claimed.ok) return none(claimed.reason)
  out.push([`### SHARE · ${source.format || 'post'} · ${source.title || source.postId}`, `- Link: ${link}`, `- From: ${from}`, '', 'Message:', '', `> ${message}`, ''].join('\n'))
  if (s.dry) {
    await settle(book, entry.key, { status: 'dry' })
    return STEP.posted
  }
  try {
    const { postId } = await graph.publishLink({ link, message })
    await settle(book, entry.key, { status: 'posted', postId })
    out.push(`Shared: ${postId}.`, '')
    return STEP.posted
  } catch (error) {
    onError?.(Object.assign(error, { share: true }))
    await settle(book, entry.key, { status: 'failed', error: error.message })
    out.push(`**Share failed**: ${error.message}. Marked failed in the ledger; not retried.`, '')
    return STEP.failed
  }
}
