/**
 * Which kind of post comes next when template types are switched on
 * (gate.mjs), and which item it carries.
 *
 * Order:
 *   1. News first. A type marked `urgent` (an episode out today, a premiere)
 *      goes before everything else while it has something new to say: always
 *      when it has at least as many items as the day has posts left, and
 *      otherwise whenever the last post was not that same type.
 *   2. Then a rotation: of the switched-on kinds (the classic post is one of
 *      them), the one used least recently takes the turn.
 *
 * What may not repeat:
 *   - the same item of the same type inside that type's own gap (gapDays)
 *   - a type with `titleGap`: the same title inside the 30-day title gap
 *   - two posts about the same title on one day, whatever the types
 *
 * A type is { key, urgent, gapDays, titleGap, window, find(data, ctx),
 * captions: [post => { hook, facts, cta }], questions: [post => text],
 * tags(post) }. find() returns its posts best
 * first; each post is { item, title, path, label, art, view }.
 *
 * Pure: the data, the history, the clock and the random source are passed in.
 */
import { CLASSIC } from './gate.mjs'
import { normTitle, TITLE_GAP_DAYS } from './ledger.mjs'
import { hashOf } from './story.mjs'
import { composeCaption, composePost, variantOf } from './text.mjs'
import { dateOf, DAY_MS } from './when.mjs'

const kindOf = (entry) => entry.type || CLASSIC

/** The ledger slug of a typed post: unique per type and item. */
export const slugOf = (type, post) => `${type.key}:${post.item}`

/** The question a post ends on: one of the type's, always the same one for the same item. */
export const questionFor = (type, post) => (type.questions?.length ? variantOf(type.questions, hashOf(post.item))(post) : null)

/**
 * One wording as text. A wording is { hook, facts, cta } (a full post: the
 * synopsis and the question are added here) or a plain list of sentences.
 * A synopsis that fails the gate (a blocked word) is dropped, not the post.
 */
function wordingText(type, post, wording, blockedTags) {
  const made = wording(post)
  const tags = type.tags ? type.tags(post) : []
  if (Array.isArray(made)) return composeCaption(made, tags, { blockedTags })
  const parts = { ...made, question: questionFor(type, post) }
  return composePost({ ...parts, synopsis: post.synopsis }, tags, { blockedTags }) || composePost(parts, tags, { blockedTags })
}

/** The caption for a post, trying each wording from this type's next turn on. */
export function captionFor(type, post, turn, blockedTags = []) {
  for (let i = 0; i < type.captions.length; i += 1) {
    const text = wordingText(type, post, variantOf(type.captions, turn + i), blockedTags)
    if (text) return { caption: text, variant: (turn + i) % type.captions.length }
  }
  return null
}

/** The rules a post must pass, built once per run from the history. */
function rulesOf({ history, now, skip }) {
  const today = dateOf(now)
  const titlesToday = new Set(history.filter((e) => e.day === today && e.title).map((e) => normTitle(e.title)))
  const titleSince = now - TITLE_GAP_DAYS * DAY_MS
  const recentTitles = new Set(history.filter((e) => e.at >= titleSince && e.title).map((e) => normTitle(e.title)))
  return (type, post) => {
    if (skip.has(slugOf(type, post))) return false
    const since = now - type.gapDays * DAY_MS
    if (history.some((e) => e.type === type.key && e.item === post.item && e.at >= since)) return false
    if (!post.title) return true
    const title = normTitle(post.title)
    if (titlesToday.has(title)) return false
    return !(type.titleGap && recentTitles.has(title))
  }
}

/** Kinds in rotation order: never used first, then the one used longest ago. */
export function rotation(kinds, history) {
  const lastUse = (key) => {
    for (let i = history.length - 1; i >= 0; i -= 1) if (kindOf(history[i]) === key) return i
    return -1
  }
  return kinds.map((kind, at) => ({ kind, at, last: lastUse(typeof kind === 'string' ? kind : kind.key) })).sort((x, y) => x.last - y.last || x.at - y.at).map((k) => k.kind)
}

function build(type, posts, start, turn, blockedTags) {
  for (let i = 0; i < posts.length; i += 1) {
    const post = posts[(start + i) % posts.length]
    const made = captionFor(type, post, turn, blockedTags)
    if (made) return { type, post, ...made }
  }
  return null
}

/**
 * The next post.
 * @param kinds the switched-on kinds in the owner's order: type objects, and the string 'classic'
 * @returns {{ classic: true } | { type, post, caption, variant } | null}
 */
export function planNext({ kinds, data, history = [], now, rng = Math.random, skip = new Set(), slotsLeft = Infinity, blockedTags = [] }) {
  const fits = rulesOf({ history, now, skip })
  const turnOf = (type) => history.filter((e) => e.type === type.key).length
  const found = new Map()
  const postsOf = (type) => {
    if (!found.has(type.key)) found.set(type.key, type.find(data, { now }).filter((post) => fits(type, post)))
    return found.get(type.key)
  }
  const last = history.length ? kindOf(history.at(-1)) : null

  for (const type of kinds.filter((k) => typeof k !== 'string' && k.urgent)) {
    const posts = postsOf(type)
    if (!posts.length) continue
    const short = Number.isFinite(slotsLeft) && slotsLeft > 0 && posts.length >= slotsLeft
    if (!short && last === type.key) continue
    const made = build(type, posts, 0, turnOf(type), blockedTags)
    if (made) return made
  }

  for (const kind of rotation(kinds, history)) {
    if (kind === CLASSIC) {
      // post.mjs puts 'classic' in `skip` once the classic picker has nothing left.
      if (skip.has(CLASSIC)) continue
      return { classic: true }
    }
    const posts = postsOf(kind)
    if (!posts.length) continue
    const start = Math.floor(rng() * Math.min(posts.length, kind.window || 1))
    const made = build(kind, posts, start, turnOf(kind), blockedTags)
    if (made) return made
  }
  return null
}
