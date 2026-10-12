/**
 * One try at one post, for a manual run (post.mjs) and for the chain
 * (chain.mjs): read the Page's history from the ledger, choose the next post
 * (plan.mjs, pick.mjs) and send it (send.mjs). The clock is read here, at the
 * moment of the try, so a run that lasts hours stamps each post with its own
 * time.
 */
import { CLASSIC, onlyClassic } from './gate.mjs'
import { dayOf } from './ledger.mjs'
import { planNext } from './plan.mjs'
import { classicStep, typedStep, STEP } from './send.mjs'
import { SITE } from './site.mjs'

/** Everything the ledger holds for this Page, oldest first (dry entries too: a dry run plays against a copy). */
export const historyOf = (ledger) => (ledger?.entries || []).filter((e) => e.page === SITE.key).sort((x, y) => x.at - y.at)

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

/**
 * @param base what stays the same for a whole run (post.mjs builds it)
 * @param loaded { pools, data } from the site's source.mjs
 * @param skip items already found unusable in this run
 * @param slotsLeft posts the rolling day still has room for
 * @param onError called with the error of a failed Graph call
 * @returns one of STEP
 */
export async function attemptOnce({ s, graph, book, kinds, rng, blockedTags, out, resolveImage, render, preview, clock }, { loaded, skip, slotsLeft, onError }) {
  const now = clock()
  const history = historyOf((await book.read()).data)
  return oneStep({ s, graph, book, kinds, pools: loaded.pools, data: loaded.data, now, day: dayOf(now), rng, blockedTags, out, resolveImage, render, preview, history, skip, slotsLeft, onError })
}
