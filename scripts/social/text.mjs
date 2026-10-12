/**
 * Words for the typed posts (types/*.mjs): text that the image fonts can
 * draw, sizes that fit, counts people can read, and the last gate a caption
 * passes before it may be posted.
 *
 * Varied wording, not spinning: every type carries a few whole captions that
 * say the same facts in a different order, and variantOf() walks through them
 * in turn. Nothing is swapped word by word.
 */

export const MAX_TEXT = 420
export const MAX_TAGS = 2
/** A full post: hook, synopsis, facts, question, the line about the comment, hashtags. */
export const MAX_POST = 1300
export const MAX_POST_TAGS = 7
/** Emojis: a couple in the hook, a couple in the rest, never more. */
export const MAX_HOOK_EMOJI = 2
export const MAX_BODY_EMOJI = 2

/**
 * What the image fonts hold: Latin, Latin-1, Latin Extended-A and the common
 * dashes, quotes and the ellipsis. Anything else (kana, stars, hearts) would
 * be drawn as an empty box, so it is taken out.
 */
const UNDRAWABLE = /[^ -~ -ſ‐-―‘-”…]/g
/** A name must keep this share of its characters to be drawn at all. */
const MIN_KEPT = 0.8

/** NFKC first, so a Roman numeral sign or a full-width letter becomes plain Latin instead of vanishing. */
export const cleanText = (value) => String(value ?? '').normalize('NFKC').replace(UNDRAWABLE, '').replace(/\s+/g, ' ').replace(/\s+([:;,.!?])/g, '$1').trim()

/** True when the fonts can draw this name (nearly) whole. */
export function isDrawable(value) {
  const raw = String(value ?? '').replace(/\s+/g, ' ').trim()
  const kept = cleanText(raw)
  return kept.length > 0 && kept.length >= raw.length * MIN_KEPT
}

/** Cut at a word, with an ellipsis, when the text is longer than `max`. */
export function clip(value, max) {
  const text = cleanText(value)
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const atWord = cut.replace(/\s+\S*$/, '')
  return `${(atWord.length > max * 0.6 ? atWord : cut).replace(/[\s,;:.\-–—]+$/, '')}…`
}

/**
 * A font size for a text by its length.
 * @param steps [[longest text, size], ...] from short to long; the last size is the floor
 */
export function fitSize(value, steps) {
  const length = cleanText(value).length
  return (steps.find(([max]) => length <= max) || steps.at(-1))[1]
}

/** 1234 -> "1.2K", 482691 -> "483K", 1250000 -> "1.3M". */
export function compact(n) {
  const value = Number(n) || 0
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (value >= 100_000) return `${Math.round(value / 1000)}K`
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}K`
  return String(value)
}

/** "A", "A and B", "A, B and C". */
export const listOf = (items) =>
  items.length <= 1 ? items.join('') : items.length === 2 ? `${items[0]} and ${items[1]}` : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`

/** "A, B and 4 more" when the list is longer than the names given; the plain list otherwise. */
export const listMore = (names, total) => (total > names.length ? `${names.join(', ')} and ${total - names.length} more` : listOf(names))

/** One sentence with exactly one full stop (a studio called "feel." brings its own). */
export const sentence = (text) => `${String(text).replace(/[.\s]+$/, '')}.`

/** The caption to use this time: the variants are taken in turn. */
export const variantOf = (variants, turn) => variants[((turn % variants.length) + variants.length) % variants.length]

/** At most two hashtags from plain words ("Sci-Fi" -> "#scifi"). */
export function hashtags(words) {
  const tags = words
    .filter(Boolean)
    .map((word) => `#${String(word).toLowerCase().replace(/[^a-z0-9]/g, '')}`)
    .filter((tag) => tag.length > 1)
  return [...new Set(tags)].slice(0, MAX_TAGS)
}

const escape = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const emojiCount = (text) => (String(text || '').match(/\p{Extended_Pictographic}/gu) || []).length

/** Why a typed caption may not be posted, or null when it may. */
export function checkText(text, { blockedTags = [], max = MAX_TEXT, emoji = 0, maxTags = MAX_TAGS } = {}) {
  if (!text || !text.trim()) return 'empty'
  if (text.length > max) return 'too long'
  if (/https?:\/\/|www\./i.test(text)) return 'link in the caption'
  if (/amazon|affiliate|\bAI\b/i.test(text)) return 'forbidden word'
  if (emojiCount(text) > emoji) return emoji ? 'too many emojis' : 'emoji'
  if ((text.match(/#/g) || []).length > maxTags) return 'too many hashtags'
  if (/\{[^}]*\|[^}]*\}/.test(text)) return 'spin syntax'
  if (/\bundefined\b|\bnull\b|\bNaN\b/.test(text)) return 'a missing fact'
  for (const tag of blockedTags) if (new RegExp(`\\b${escape(tag)}\\b`, 'i').test(text)) return `blocked word: ${tag}`
  return null
}

/**
 * Sentences and tags as one caption, or null when it fails the gate.
 * @param sentences strings; empty ones are left out
 */
export function composeCaption(sentences, tagWords = [], options = {}) {
  const body = sentences.filter(Boolean).join(' ')
  const tags = hashtags(tagWords)
  const text = body + (tags.length ? `\n\n${tags.join(' ')}` : '')
  return checkText(text, options) ? null : text
}

/**
 * A full post, or null when it fails the gate. The order is fixed: the hook,
 * a short synopsis, the key facts, a question, the line that points at the
 * first comment, then the hashtags. Empty parts are left out.
 * @param parts { hook, synopsis, facts: [sentences], question, cta }
 * @param tags hashtags as they will be written ("#OnePiece")
 */
export function composePost({ hook, synopsis, facts = [], question, cta }, tags = [], options = {}) {
  if (!hook || !cta) return null
  const rest = [synopsis, facts.filter(Boolean).join(' '), question, cta].filter(Boolean)
  if (emojiCount(hook) > MAX_HOOK_EMOJI || emojiCount(rest.join(' ')) > MAX_BODY_EMOJI) return null
  const text = [hook, ...rest, tags.slice(0, MAX_POST_TAGS).join(' ')].filter(Boolean).join('\n\n')
  return checkText(text, { max: MAX_POST, emoji: MAX_HOOK_EMOJI + MAX_BODY_EMOJI, maxTags: MAX_POST_TAGS, ...options }) ? null : text
}
