/**
 * The chain: one long workflow run that posts, waits and posts again.
 *
 * GitHub's hourly schedule proved unreliable (12 Oct 2026: no scheduled run
 * for over three hours in either repo), so the poster no longer depends on
 * it. One run loops for FB_CHAIN_MINUTES (under the six-hour job limit),
 * then the workflow starts its successor and this one ends. A cron job is
 * only the backstop that starts a chain when none is running.
 *
 * Each turn of the loop:
 *   1. read the ledger; wait until the gap, the even pace and the rolling
 *      cap all allow a post (pace.mjs), and no block or back-off is in force.
 *      Reels have their own lane: their own daily number and even pace, out
 *      of the posts' cap, and never within five minutes of another post.
 *      Whichever lane is due first takes the turn
 *   2. refresh the data when it is an hour old
 *   3. try one post (attempt.mjs)
 *   4. read what the answer says about Facebook's limits (limits.mjs)
 *
 * What stops it: a refused token, or MAX_FAILS failed posts in a row. Both
 * end the run red and leave a note (`health.halted`) so the backstop does
 * not start it again; the owner starts it by hand once it is fixed. One
 * failed post never stops it: it is logged, the gap passes, the loop goes on.
 * With nothing fresh to post it waits and looks again; it never repeats an
 * item to fill the time.
 *
 * A reel that fails never stops the chain and is never counted as one of
 * those failures, whatever Facebook answered (a missing permission comes
 * back looking like a refused token): it is written down (`health.reel`),
 * reels rest for a few hours, and the other posts go on. A failed share of
 * the sister Page's post (share.mjs) is treated the same way. Only a token that
 * is really dead (code 190) or a block still does what it does for any post.
 *
 * Everything from outside (the clock, sleep, the ledger, the Graph client)
 * is passed in, so the tests run a whole chain in no time.
 */
import { attemptOnce, POST_LANE, REEL_LANE } from './attempt.mjs'
import { SHARE_REST_MS } from './share.mjs'
import { REEL_REST_MS } from './attempt.mjs'
import { backoffMs, effectiveCap, saveHealth, signalOf, usageSignal, withHalt, withPeak, withReelFailure, withShareFailure, withSignal } from './limits.mjs'
import { countedEntries, nextWait, postLane, reelLane, rollingCount, MIN_GAP_MINUTES, MINUTE_MS } from './pace.mjs'
import { STEP } from './send.mjs'
import { SITE } from './site.mjs'
import { timeOf } from './when.mjs'

/** The data is read again when it is this old. */
export const REFRESH_MS = 60 * MINUTE_MS
/** With nothing fresh to post, or no data, the loop looks again after this long. */
export const IDLE_MS = 20 * MINUTE_MS
/** This many failed posts in a row end the chain for the owner to look. */
export const MAX_FAILS = 5
/** Items in a row that turn out unusable before the loop takes a rest. */
const MAX_SKIPS = 12

const WHY = { gap: 'the minimum gap', pace: 'the even pace', cap: 'the cap for 24 hours is reached', block: 'Facebook signalled a block', backoff: 'backing off after a limit signal' }
const minutes = (ms) => Math.max(1, Math.round(ms / MINUTE_MS))

export const usageLine = (usage) => (usage ? `Highest usage seen this run: **${usage.pct}%** (${usage.source}).` : 'Highest usage seen this run: Facebook sent no usage header (far from the call budget).')

/** Wait for the next post, or to the end of this run when the wait is longer than that. */
async function waitOut(wait, now, deadline, { say, sleep, what = 'post' }) {
  const over = wait.at >= deadline
  say(`${timeOf(now)} ET: waiting ${minutes(Math.min(wait.at, deadline) - now)} min (${WHY[wait.why]}). ${over ? 'The next run of the chain takes over from there.' : `Next ${what} at about ${timeOf(wait.at)} ET.`}`)
  await sleep(Math.min(wait.at, deadline) - now)
}

/** The data, read again when it is an hour old. False when it could not be read. */
async function freshData(state, now, { loadPools, say, skip }) {
  if (state.loaded && now - state.loadedAt < REFRESH_MS) return true
  try {
    state.loaded = await loadPools({ now })
    state.loadedAt = now
    skip.clear()
    say(`Data: ${state.loaded.source}.`)
    return true
  } catch (error) {
    say(`No data (${error.message}). Looking again in ${minutes(IDLE_MS)} minutes.`)
    return false
  }
}

/** Write down what a failed call says about a limit, and hold the loop back. True when it was a limit signal. */
async function onLimit(signal, { state, s, book, clock, say, reached, usage }) {
  if (!signal) return false
  const now = clock()
  const health = await saveHealth(book, (h) => withSignal(h, signal, { now, reached, perDay: s.perDay, usage }), `Limit signal: ${signal.kind}`)
  if (signal.kind === 'block') {
    say(`**Facebook signalled a block** (code ${signal.code}: ${signal.note}). No posts for 24 hours, until about ${timeOf(now)} ET tomorrow. The Page had reached ${reached} posts in 24 hours, so the cap is cut from ${s.perDay} to ${health?.cut?.cap ?? '?'}. Change FB_POSTS_PER_DAY by hand to lift the cut.`)
    return true
  }
  state.backoff += 1
  state.holdUntil = now + backoffMs(state.backoff, s.gapMinutes)
  say(`**Limit signal** (code ${signal.code}: ${signal.note}). Backing off for ${minutes(state.holdUntil - now)} minutes.`)
  return true
}

/** Graph's code for a token that is expired or no longer valid. */
const TOKEN_DEAD = 190

/** A reel that failed: write down what Facebook said and go on with the other posts. */
async function reelFailed(failure, c) {
  const signal = signalOf(failure)
  if (signal?.kind === 'block') return void (await onLimit(signal, c))
  await saveHealth(c.book, (h) => withReelFailure(h, failure, c.clock()), 'Reel failed').catch(() => null)
  c.say(`**A reel failed** (code ${failure.code || 0}: ${failure.message}). No reel for ${Math.round(REEL_REST_MS / MINUTE_MS / 60)} hours; the other posts go on.`)
}

/** A share that failed: the same as a reel, with its own note and rest (share.mjs). */
async function shareFailed(failure, c) {
  const signal = signalOf(failure)
  if (signal?.kind === 'block') return void (await onLimit(signal, c))
  await saveHealth(c.book, (h) => withShareFailure(h, failure, c.clock()), 'Share failed').catch(() => null)
  c.say(`**A share failed** (code ${failure.code || 0}: ${failure.message}). No share for ${Math.round(SHARE_REST_MS / MINUTE_MS / 60)} hours; the other posts go on.`)
}

/** What the turn does with the answer of one try. Returns the chain's result when it must stop, null to go on. */
async function afterTry(step, failure, c) {
  const { state, s, book, clock, say, graph, reached } = c
  const usage = graph?.usage?.() || null
  if (usage) await saveHealth(book, (h) => withPeak(h, usage, clock()), 'Usage peak')
  if (step === STEP.posted) {
    Object.assign(state, { posted: state.posted + 1, fails: 0, skips: 0 })
    // A post that went through ends a back-off, unless the call budget is nearly spent.
    if (!(await onLimit(usageSignal(usage), { ...c, reached: reached + 1, usage }))) state.backoff = 0
    return null
  }
  if (step === STEP.skipped && (state.skips += 1) <= MAX_SKIPS) return null
  if (step === STEP.none && c.lane === REEL_LANE) {
    // No reel can be made now: the reel lane sits out until the data is read again; the posts are not held up.
    c.skip.add(REEL_LANE)
    say(`${timeOf(clock())} ET: no reel to make right now. Reels wait for the next data refresh.`)
    return null
  }
  if (step !== STEP.failed) {
    Object.assign(state, { skips: 0, loadedAt: 0 })
    say(`${timeOf(clock())} ET: nothing fresh to post (every item is inside its repeat gap). Looking again in ${minutes(IDLE_MS)} minutes.`)
    await c.rest()
    return null
  }
  if (failure?.reel && failure.code !== TOKEN_DEAD) {
    await reelFailed(failure, { ...c, usage })
    return null
  }
  if (failure?.share && failure.code !== TOKEN_DEAD) {
    await shareFailed(failure, { ...c, usage })
    return null
  }
  if (failure?.isAuth) return c.halt('the Page token was refused', `**The Page token was refused** (${failure.message}). The chain stops. Make a new long-lived Page token, update the FB_PAGE_TOKEN secret, then start the workflow by hand.`)
  if (await onLimit(signalOf(failure), { ...c, usage })) return null
  return c.stumble('That post failed')
}

/** True when a reel may be looked for: a reel type is switched on, the daily number is not 0, and the lane has not sat out. */
const reelsOn = (base, skip) => base.s.reelsPerDay > 0 && !skip.has(REEL_LANE) && (base.kinds || []).some((kind) => typeof kind !== 'string' && kind.reel)

/** After a reel that failed, the reel lane rests (attempt.mjs REEL_REST_MS). */
const reelRestUntil = (reels) => reels.filter((e) => e.status === 'failed').reduce((until, e) => Math.max(until, e.at + REEL_REST_MS), 0)

/** One turn of the loop: wait if a rule says so, else try one post. */
async function turn(base, c) {
  const { s, book, clock, sleep, loadPools, flush } = base
  const { state, skip, say, deadline } = c
  const now = clock()
  if (now >= deadline) return c.finish(0, true, `${timeOf(now)} ET: this run is done (${state.posted} posted). Handing over to the next run of the chain.`)
  const ledger = (await book.read()).data
  const counted = countedEntries(ledger, SITE.key)
  const entries = postLane(counted)
  const reels = reelLane(counted)
  const health = ledger.health || {}
  const cap = effectiveCap(health, s.perDay)
  const stops = { blockedUntil: health.blockedUntil || 0, holdUntil: state.holdUntil }
  const postWait = nextWait({ entries, others: reels, now, cap, gapMinutes: s.gapMinutes, ...stops })
  const reelWait = reelsOn(base, skip) ? nextWait({ entries: reels, others: entries, now, cap: s.reelsPerDay, gapMinutes: MIN_GAP_MINUTES, ...stops, holdUntil: Math.max(state.holdUntil, reelRestUntil(reels)) }) : null
  const lane = reelWait && reelWait.at <= postWait.at ? REEL_LANE : POST_LANE
  const wait = lane === REEL_LANE ? reelWait : postWait
  if (wait.ms > 0) {
    await waitOut(wait, now, deadline, { say, sleep, what: lane === REEL_LANE ? 'reel' : 'post' })
    return null
  }
  if (!(await freshData(state, now, { loadPools, say, skip }))) {
    await c.rest()
    return null
  }
  let failure = null
  const reached = rollingCount(entries, now)
  const step = await attemptOnce(base, { loaded: state.loaded, skip, slotsLeft: cap - reached, lane, onError: (error) => (failure = error) })
  flush()
  return afterTry(step, failure, { ...c, s, book, clock, graph: base.graph, reached, lane })
}

/**
 * @param base { s, graph, book, clock, sleep, out, flush, loadPools, ... } from post.mjs
 * @returns {{ code: 0|1, next: boolean, posted: number }} `next` is true when the workflow should start the successor
 */
export async function runChain(base) {
  const { s, graph, book, clock, sleep, out, flush } = base
  const say = (line) => {
    out.push(line, '')
    flush()
  }
  const deadline = clock() + s.chainMinutes * MINUTE_MS
  const state = { loaded: null, loadedAt: 0, fails: 0, backoff: 0, holdUntil: 0, skips: 0, posted: 0 }
  const finish = (code, next, line) => {
    say(line)
    say(usageLine(graph?.usage?.() || null))
    return { code, next, posted: state.posted }
  }
  const halt = async (why, line) => {
    await saveHealth(book, (h) => withHalt(h, why, clock()), 'Chain halted').catch(() => null)
    return finish(1, false, line)
  }
  /** One more failure in a row: the chain goes on, until there are MAX_FAILS of them. */
  const stumble = async (what) => {
    state.fails += 1
    if (state.fails >= MAX_FAILS) return halt(`${MAX_FAILS} failures in a row`, `**${MAX_FAILS} failures in a row** (the last: ${what}). The chain stops for you to look. Start the workflow by hand once it is fixed.`)
    say(`${what} (${state.fails} in a row; the chain stops at ${MAX_FAILS}). It goes on after the gap.`)
    return null
  }
  const rest = async () => sleep(Math.max(0, Math.min(IDLE_MS, deadline - clock())))
  const c = { state, skip: new Set(), say, deadline, finish, halt, stumble, rest }
  say(`Chain: this run posts until about ${timeOf(deadline)} ET, then starts the next one.`)

  for (;;) {
    let done
    try {
      done = await turn(base, c)
    } catch (error) {
      // A step that broke outside a post (the ledger could not be read, say): rest, then go on.
      done = await stumble(`A step failed (${error.message})`)
      if (!done) await rest()
    }
    if (done) return done
  }
}
