/**
 * One try at one post, for a manual run (post.mjs) and for the chain
 * (chain.mjs): read the Page's history from the ledger, choose the next post
 * (plan.mjs, pick.mjs) and send it (send.mjs). The clock is read here, at the
 * moment of the try, so a run that lasts hours stamps each post with its own
 * time.
 */
import { CLASSIC, onlyClassic } from './gate.mjs'
import { dayOf } from './ledger.mjs'
import { DAY_MS, HOUR_MS } from './pace.mjs'
import { planNext } from './plan.mjs'
import { classicStep, typedStep, STEP } from './send.mjs'
import { shareOpen, shareStep, SHARE } from './share.mjs'
import { SITE } from './site.mjs'

/** Everything the ledger holds for this Page, oldest first (dry entries too: a dry run plays against a copy). */
export const historyOf = (ledger) => (ledger?.entries || []).filter((e) => e.page === SITE.key).sort((x, y) => x.at - y.at)

/** After a reel that Facebook refused, no reel is tried for this long: the other posts go on meanwhile. */
export const REEL_REST_MS = 6 * HOUR_MS
/** Fan art and cosplay (kinds marked `rare`) together: at most one post in this many, so never two in a row. */
export const RARE_EVERY = 8
/** The chain's two lanes (pace.mjs): the posts, with shares, on FB_POSTS_PER_DAY; the reels on FB_REELS_PER_DAY. */
export const POST_LANE = 'post'
export const REEL_LANE = 'reel'

/**
 * The kinds on offer for this try. A reel kind is left out when the last
 * post was a reel (never two back to back), when the rolling day has had
 * its reels (FB_REELS_PER_DAY, their own budget, out of the posts' cap), or when a
 * reel failed in the last REEL_REST_MS. A rare kind (fan art, cosplay) is left
 * out while one of the last RARE_EVERY - 1 posts was one.
 * In the chain, `lane` keeps to one lane: REEL_LANE offers only the reels
 * (their own pace keeps them apart), POST_LANE everything but the reels.
 */
export function kindsNow(kinds, history, now, reelsPerDay, lane = null) {
  const used = history.filter((e) => e.reel && e.at > now - DAY_MS).length
  const resting = history.some((e) => e.reel && e.status === 'failed' && e.at > now - REEL_REST_MS)
  // The chain's reel lane keeps reels apart by its own even pace (pace.mjs), not by what went last.
  const open = used < reelsPerDay && !resting && (lane === REEL_LANE || !history.at(-1)?.reel)
  const rareOpen = !history.slice(-(RARE_EVERY - 1)).some((e) => e.rare)
  const isReel = (kind) => typeof kind !== 'string' && Boolean(kind.reel)
  if (lane === REEL_LANE) return open ? kinds.filter(isReel) : []
  if (lane === POST_LANE) return kinds.filter((kind) => !isReel(kind) && (typeof kind === 'string' || rareOpen || !kind.rare))
  return kinds.filter((kind) => typeof kind === 'string' || ((open || !kind.reel) && (rareOpen || !kind.rare)))
}

/** Choose the next post and send it. */
async function oneStep({ kinds: all, data, pools, resolveImage, render, preview, fetch, lane, ...ctx }) {
  const { history, now, rng, skip, slotsLeft, blockedTags } = ctx
  // A share of the sister Page's post takes the turn when its rules allow (share.mjs), inside the cap.
  // Nothing to share: the normal post goes instead, and no share is looked for again until the data is refreshed.
  if (lane !== REEL_LANE && ctx.s.share?.on && !skip.has(SHARE) && shareOpen(history, now, ctx.s.share.perDay)) {
    const step = await shareStep({ ...ctx, fetch })
    if (step !== STEP.none) return step
    skip.add(SHARE)
  }
  const kinds = kindsNow(all, history, now, ctx.s.reelsPerDay, lane)
  if (!kinds.length) return STEP.none
  const plan = onlyClassic(kinds) ? { classic: true } : planNext({ kinds, data, history, now, rng, skip, slotsLeft, blockedTags })
  if (!plan) return STEP.none
  if (!plan.classic) return typedStep({ ...ctx, plan, render, preview })
  const step = await classicStep({ ...ctx, pools, resolveImage })
  if (step !== STEP.none || onlyClassic(kinds)) return step
  // The classic post has nothing left; the other kinds take the turn.
  skip.add(CLASSIC)
  return STEP.skipped
}

/**
 * @param base what stays the same for a whole run (post.mjs builds it)
 * @param loaded { pools, data } from the site's source.mjs
 * @param skip items already found unusable in this run
 * @param slotsLeft posts the rolling day still has room for
 * @param onError called with the error of a failed Graph call
 * @returns one of STEP
 */
export async function attemptOnce({ s, graph, ig = null, book, kinds, rng, blockedTags, out, resolveImage, render, preview, clock, sleep, fetch }, { loaded, skip, slotsLeft, onError, lane = null }) {
  const now = clock()
  const history = historyOf((await book.read()).data)
  return oneStep({ s, graph, ig, book, kinds, pools: loaded.pools, data: loaded.data, now, day: dayOf(now), rng, blockedTags, out, resolveImage, render, preview, history, skip, slotsLeft, onError, sleep, fetch, lane })
}
