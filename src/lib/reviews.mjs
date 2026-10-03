/**
 * Reader ratings and written reviews. Pure: no database, no clock, no fetch.
 * Shared by the Worker (which checks and saves a vote or a review,
 * src/lib/reviews-api.js), the title page (which draws them and marks them up
 * for search engines) and the review form in the reader's browser, which runs
 * the very same link check before anything is sent.
 *
 * The owner's rule is short: a review is plain words about the story. No
 * links, no web addresses, no handles, no HTML. A review that breaks it is
 * refused, never cleaned up and saved, because a "cleaned" link is still an
 * advert for whoever wrote it. Nothing is public until the owner approves it.
 *
 * The tables are in db/migrations/0007-reviews.sql.
 */

// Same widget the visit counter uses (src/layouts/Base.astro, MI_SITEKEY).
// The site key is public by design: it names the widget, nothing more. The
// secret that checks a ticket is the Worker secret TURNSTILE_SECRET.
export const TURNSTILE_SITEKEY = '0x4AAAAAAE8pcD79Cqtyp6rS'

export const KINDS = ['manhwa', 'manga', 'manhua', 'novel', 'anime']
export const MIN_TEXT = 30
export const MAX_TEXT = 1500
export const MAX_NAME = 40
export const DEFAULT_NAME = 'A reader'
// Under three votes an average is one person's opinion, so the page says
// "be the first" instead of printing it.
export const SHOW_AVERAGE_FROM = 3
// Search engines get the average only from five votes. A star snippet built
// on two votes is the kind of thing that earns a manual action.
export const SCHEMA_FROM = 5
// How many approved reviews a title page draws, newest first.
export const SHOW_REVIEWS = 10
// Reviews one address may send in one day.
export const DAILY_REVIEWS = 3
// If this many reviews are already waiting, new ones are refused until the
// owner has read some. A flood can never fill the database or the tab.
export const MAX_PENDING = 300

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,158}[a-z0-9])?$/
const MAX_TICKET = 2048

// ------------------------------------------------------------- the link rule

// Endings a web address is written with. The common ones, the ones spam and
// copy sites live on, and the country endings readers of this site use.
const TLDS = [
  'com', 'net', 'org', 'io', 'co', 'xyz', 'me', 'ly', 'gg', 'tv', 'app', 'site', 'online', 'top',
  'info', 'biz', 'ru', 'cn', 'in', 'pk', 'uk', 'us', 'ca', 'au', 'de', 'fr', 'jp', 'kr', 'to', 'cc',
  'ws', 'su', 'tk', 'ml', 'ga', 'cf', 'gq', 'live', 'club', 'shop', 'store', 'link', 'click', 'blog',
  'dev', 'ai', 'fun', 'icu', 'vip', 'win', 'bid', 'pro', 'mobi', 'asia', 'eu', 'nl', 'es', 'pl',
  'br', 'mx', 'id', 'ph', 'vn', 'th', 'tr', 'ir', 'sa', 'ae', 'ng', 'ke', 'za', 'tw', 'hk', 'sg',
  'nz', 'ch', 'se', 'dk', 'fi', 'cz', 'ro', 'hu', 'gr', 'pt', 'ua', 'kz', 'il', 'eg', 'ar', 'cl',
  'pe', 'moe', 'lol', 'fm', 'la', 'nu', 'cx', 'sx', 'one', 'world', 'today', 'space', 'website',
  'tech', 'cloud', 'host', 'news', 'stream', 'watch', 'read', 'manga', 'anime', 'xxx', 'porn', 'sex',
  'bd', 'lk', 'np', 'cyou', 'cam', 'rest', 'buzz', 'work', 'life', 'page',
]
// The endings that are also everyday English words. "word.tld" with no space
// is still a link, but "dot in", "dot me" or "dot today" is just a sentence,
// so the spelled-out form only counts for the rest.
const WORDY = new Set(['in', 'me', 'to', 'top', 'one', 'win', 'live', 'club', 'shop', 'store', 'link',
  'click', 'fun', 'id', 'world', 'today', 'space', 'news', 'stream', 'watch', 'read', 'manga',
  'anime', 'life', 'work', 'page', 'rest', 'host', 'cloud', 'tech', 'pro', 'sex', 'la', 'nu', 'cam'])
const TLD = TLDS.join('|')
const SPELLED_TLD = TLDS.filter((t) => !WORDY.has(t)).join('|')

// Each rule: the pattern on the folded text, and what the reader is told.
const LINK_RULES = [
  // Any scheme: http://, https://, ftp://, and spaced out "h t t p s : / /".
  [/[a-z][a-z0-9+.-]*\s*:\s*\/\s*\//, 'web addresses'],
  [/\bh\s*[tx]\s*[tx]\s*p\s*s?\s*:/, 'web addresses'],
  [/\b(?:javascript|vbscript|data)\s*:/, 'web addresses'],
  // www. and its disguises: "www .", "w w w", "www,".
  [/\bw\s*w\s*w\s*\d?\s*[.,]/, 'web addresses'],
  [/(?:^|[^a-z0-9])www(?![a-z0-9])/, 'web addresses'],
  // word.tld, and word .tld with a space before the dot (prose never puts a
  // space before a full stop). A space AFTER the dot is a sentence ending:
  // "I loved it. In the end" must pass, so that form is never matched.
  [new RegExp(`(?:^|[^a-z0-9])[a-z0-9][a-z0-9-]*\\s?\\.(?:${TLD})(?![a-z0-9])`), 'web addresses'],
  // "coolmanga . com": spaces on both sides of the dot.
  [new RegExp(`[a-z0-9]\\s+\\.\\s+(?:${TLD})(?![a-z0-9])`), 'web addresses'],
  // "dot com", "dotcom", "d0t net".
  [new RegExp(`\\bd[o0]t+\\s*-?\\s*(?:${SPELLED_TLD})(?![a-z0-9])`), 'web addresses'],
  // "(dot)", "[.]", "{dot}", "<.>": only ever used to hide an address.
  [/[[({<]\s*(?:d[o0]t|\.)\s*[\])}>]/, 'web addresses'],
  // An address written as numbers, and international ones written as xn--.
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/, 'web addresses'],
  [/\bxn--/, 'web addresses'],
  // Links in Markdown, forum code or HTML.
  [/\[[^\]]*\]\s*\(/, 'links'],
  [/\[\s*\/?\s*(?:url|link|img)\b/, 'links'],
  [/\bhref\s*=/, 'links'],
  // E-mail addresses and @handles, and "name (at) mail".
  [/@/, 'e-mail addresses or @handles'],
  [/[[({<]\s*at\s*[\])}>]/, 'e-mail addresses or @handles'],
  [/\b(?:gmail|hotmail|protonmail)\b/, 'e-mail addresses or @handles'],
]

/**
 * The text as the link rule reads it: compatibility forms folded (so
 * "ｗｗｗ．" and "ʜᴛᴛᴘ" read as their plain letters), invisible characters
 * dropped (so "goo​gle.com" is still one word), every kind of dot made
 * a dot, and lower case. Only for checking: the review itself is kept as the
 * reader wrote it.
 */
export function fold(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[​-‏⁠-⁤﻿­͏᠎]/g, '')
    .replace(/[。｡﹒․·•∙⋅܁܂]/g, '.')
    .toLowerCase()
}

/**
 * Null when the text holds no link, or { reason, found } for the first one:
 * what kind of thing it is (said to the reader as "no web addresses") and the
 * bit of text that tripped it, so the reader can see what to change.
 */
export function linkProblem(text) {
  const folded = fold(text)
  for (const [rule, reason] of LINK_RULES) {
    const hit = rule.exec(folded)
    if (hit) return { reason, found: hit[0].trim().slice(0, 40) }
  }
  // Letters and digits only, so "h t t p", "h-t-t-p" and "d.o.t c.o.m" fold
  // into one word. Only the two spellings no English word contains are
  // looked for here; a domain test on squeezed text would match everything.
  const squeezed = folded.replace(/[^a-z0-9]/g, '')
  const hidden = /h[tx]{2}ps?|dot(?:com|net|org)/.exec(squeezed)
  if (hidden) return { reason: 'web addresses', found: hidden[0] }
  return null
}

// ------------------------------------------------------------ the other rules

/** True when the text holds HTML: a tag, a comment or an entity. */
export function hasHtml(text) {
  // A tag starts right after the "<"; "x < y" and "<3" are just text.
  return /<[a-z!/?]/i.test(String(text ?? '')) || /&(?:[a-z][a-z0-9]{1,30}|#\d{1,7}|#x[0-9a-f]{1,6});/i.test(String(text ?? ''))
}

/**
 * Null, or what is wrong with the text in a few words. The common shapes of
 * junk: one key held down, the same word over and over, shouting, and phone
 * numbers or long strings of digits.
 */
export function spamProblem(text) {
  const s = String(text ?? '')
  if (/(.)\1{5,}/su.test(s)) return 'Too many repeated characters.'
  if (/(?:^|\s)(\S+)(?:\s+\1){3,}(?=\s|$)/iu.test(s)) return 'The same word over and over.'
  const letters = (s.match(/\p{L}/gu) || []).length
  const upper = (s.match(/\p{Lu}/gu) || []).length
  if (letters >= 20 && upper / letters > 0.6) return 'Please do not write in capitals.'
  if (/\d(?:[\s().+-]*\d){8,}/.test(s)) return 'No phone numbers or long numbers.'
  const solid = s.replace(/\s/g, '').length
  const digits = (s.match(/\d/g) || []).length
  if (solid && digits / solid > 0.3) return 'Too many numbers.'
  return null
}

/**
 * The text as it is kept: control characters gone (a new line stays), no
 * invisible characters, spaces squeezed, at most one empty line in a row.
 */
export function cleanText(text) {
  return String(text ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[​-‏⁠-⁤﻿­͏᠎]/g, '')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** A name on one line, squeezed, or the default when left empty. */
export function cleanName(name) {
  const one = cleanText(name).replace(/\s+/g, ' ')
  return one || DEFAULT_NAME
}

/** Length in characters as a reader counts them (an emoji is one). */
export const lengthOf = (text) => [...String(text ?? '')].length

/** Stars as a whole number 1-5, null for "no score", or undefined when bad. */
function starsOf(value, optional) {
  if (optional && (value === null || value === undefined || value === '' || value === 0)) return null
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : undefined
}

/** A ticket or pass as sent by the page: short text, or ''. */
function ticketOf(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TICKET ? value : ''
}

function checkTitle(body) {
  if (!KINDS.includes(body.kind)) return 'unknown section'
  if (typeof body.slug !== 'string' || !SLUG.test(body.slug)) return 'unknown title'
  return null
}

function strictKeys(body, keys) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'the body must be a JSON object'
  for (const key of Object.keys(body)) if (!keys.has(key)) return `unknown field ${key.slice(0, 20)}`
  return null
}

const VOTE_KEYS = new Set(['kind', 'slug', 'stars', 'token', 'pass'])
const REVIEW_KEYS = new Set(['kind', 'slug', 'name', 'text', 'stars', 'token'])

/**
 * Check one vote's body. Returns { value } or { error }. It must name a title,
 * carry 1 to 5 stars, and carry proof a browser is here: a fresh Turnstile
 * ticket, or the half-hour pass the page already got for the visit counter.
 */
export function checkVote(body) {
  const shape = strictKeys(body, VOTE_KEYS)
  if (shape) return { error: shape }
  const title = checkTitle(body)
  if (title) return { error: title }
  const stars = starsOf(body.stars, false)
  if (stars === undefined) return { error: 'stars must be 1 to 5' }
  const token = ticketOf(body.token)
  const pass = ticketOf(body.pass)
  if (!token && !pass) return { error: 'the browser check is missing' }
  return { value: { kind: body.kind, slug: body.slug, stars, token, pass } }
}

/**
 * Check one review's body. Returns { value } or { error, field }. The error is
 * written for the reader, because the form shows it as it is.
 */
export function checkReview(body) {
  const shape = strictKeys(body, REVIEW_KEYS)
  if (shape) return { error: shape }
  const title = checkTitle(body)
  if (title) return { error: title }
  if (body.name !== undefined && typeof body.name !== 'string') return { error: 'The name must be text.', field: 'name' }
  if (typeof body.text !== 'string') return { error: 'Write your review first.', field: 'text' }

  const name = cleanName(body.name || '')
  if (lengthOf(name) > MAX_NAME) return { error: `Keep the name under ${MAX_NAME} characters.`, field: 'name' }
  const nameLink = linkProblem(name)
  if (hasHtml(name) || nameLink) return { error: 'The name cannot hold a link, an address or a handle.', field: 'name' }

  const text = cleanText(body.text)
  const n = lengthOf(text)
  if (n < MIN_TEXT) return { error: `A few more words, please: at least ${MIN_TEXT} characters.`, field: 'text' }
  if (n > MAX_TEXT) return { error: `Keep it under ${MAX_TEXT} characters.`, field: 'text' }
  if (hasHtml(text)) return { error: 'Plain text only, no HTML.', field: 'text' }
  const link = linkProblem(text)
  if (link) return { error: linkMessage(link), field: 'text' }
  const spam = spamProblem(text)
  if (spam) return { error: spam, field: 'text' }

  const stars = starsOf(body.stars, true)
  if (stars === undefined) return { error: 'The score must be 1 to 5 stars, or none.', field: 'stars' }
  const token = ticketOf(body.token)
  if (!token) return { error: 'the browser check is missing' }
  return { value: { kind: body.kind, slug: body.slug, name, text, stars, token } }
}

/** What the reader is told when the link rule refuses a review. */
export function linkMessage(problem) {
  return `No links, ${problem.reason} or site names, please. Remove "${problem.found}".`
}

// ------------------------------------------------------------- the numbers

/**
 * A title's rating from its totals row: the average to one decimal, and
 * whether it is worth printing (SHOW_AVERAGE_FROM) and marking up
 * (SCHEMA_FROM). Bad or missing input reads as no votes.
 */
export function ratingOf(row) {
  const votes = Number.isSafeInteger(Number(row?.votes)) && Number(row.votes) > 0 ? Number(row.votes) : 0
  const total = Number(row?.total) || 0
  // An average outside 1-5 means the row is broken; say nothing rather than
  // print a number nobody gave.
  const raw = votes ? total / votes : 0
  if (!votes || raw < 1 || raw > 5) return { votes: 0, avg: 0, show: false, schema: false }
  const avg = Math.round(raw * 10) / 10
  return { votes, avg, show: votes >= SHOW_AVERAGE_FROM, schema: votes >= SCHEMA_FROM }
}

/** The line beside the stars. */
export function ratingLine(rating) {
  if (rating.show) return `${rating.avg.toFixed(1)} from ${rating.votes} readers`
  return rating.votes > 0 ? 'A few ratings in. Add yours.' : 'Be the first to rate it.'
}

/** "3 Oct 2026", the date under a review. */
export function reviewDate(iso) {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/\bSept\b/, 'Sep')
}

/** A review's text as paragraphs, split where the reader left an empty line. */
export const paragraphsOf = (text) => String(text ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)

// ---------------------------------------------------------- structured data

/**
 * schema.org AggregateRating, or null. Only our own readers' votes, only from
 * SCHEMA_FROM votes, and only the numbers the page also prints. The AniList
 * score is never marked up: it belongs to another site.
 */
export function aggregateJsonld(rating) {
  if (!rating?.schema) return null
  return {
    '@type': 'AggregateRating',
    ratingValue: rating.avg.toFixed(1),
    bestRating: '5',
    worstRating: '1',
    ratingCount: rating.votes,
  }
}

/** schema.org Review items for approved reviews, the same ones the page draws. */
export function reviewsJsonld(reviews) {
  return (Array.isArray(reviews) ? reviews : []).map((r) => ({
    '@type': 'Review',
    author: { '@type': 'Person', name: r.name || DEFAULT_NAME },
    ...(String(r.created_at || '').length >= 10 ? { datePublished: String(r.created_at).slice(0, 10) } : {}),
    reviewBody: r.body,
    ...(Number.isInteger(r.stars) && r.stars >= 1 && r.stars <= 5
      ? { reviewRating: { '@type': 'Rating', ratingValue: String(r.stars), bestRating: '5', worstRating: '1' } }
      : {}),
  }))
}

// -------------------------------------------------------------------- SQL

// A vote, then the title's total recounted from the votes in the same batch.
// INSERT OR IGNORE: a repeat from the same browser and address that day is
// dropped by the UNIQUE key, and the recount then changes nothing.
export const VOTE_INSERT = `INSERT OR IGNORE INTO rating_votes (anilist_id, stars, day, voter, created_at)
  VALUES (?, ?, ?, ?, ?)`
export const TOTALS_RECOUNT = `INSERT INTO rating_totals (anilist_id, votes, total, updated_at)
  SELECT ?, COUNT(*), COALESCE(SUM(stars), 0), ? FROM rating_votes WHERE anilist_id = ?
  ON CONFLICT(anilist_id) DO UPDATE SET votes = excluded.votes, total = excluded.total,
    updated_at = excluded.updated_at`
export const TOTALS_READ = 'SELECT votes, total FROM rating_totals WHERE anilist_id = ?'
export const APPROVED_READ = `SELECT id, name, body, stars, created_at FROM reviews
  WHERE anilist_id = ? AND status = 'approved' ORDER BY approved_at DESC LIMIT ${SHOW_REVIEWS}`

export const REVIEW_INSERT = `INSERT INTO reviews (anilist_id, kind, slug, title, name, body, stars, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
export const SENDS_READ = 'SELECT n FROM review_sends WHERE day = ? AND sender = ?'
export const SENDS_BUMP = `INSERT INTO review_sends (day, sender, n) VALUES (?, ?, 1)
  ON CONFLICT(day, sender) DO UPDATE SET n = n + 1`
export const PENDING_COUNT = "SELECT COUNT(*) AS n FROM reviews WHERE status = 'pending'"

// What the admin tab lists. Bounded: the tab is read on a phone.
export const PENDING_LIST = `SELECT id, anilist_id, kind, slug, title, name, body, stars, created_at FROM reviews
  WHERE status = 'pending' ORDER BY created_at DESC LIMIT 100`
export const APPROVED_LIST = `SELECT id, anilist_id, kind, slug, title, name, body, stars, created_at, approved_at FROM reviews
  WHERE status = 'approved' ORDER BY approved_at DESC LIMIT 100`
export const REVIEW_APPROVE = "UPDATE reviews SET status = 'approved', approved_at = ? WHERE id = ? AND status = 'pending'"
export const REVIEW_DELETE = 'DELETE FROM reviews WHERE id = ?'
export const REVIEW_FIND = 'SELECT anilist_id, title FROM reviews WHERE id = ?'

// The night job: the hashes stop being useful after a day, so they go.
export const FORGET_VOTERS = 'UPDATE rating_votes SET voter = NULL WHERE day < ? AND voter IS NOT NULL'
export const FORGET_SENDS = 'DELETE FROM review_sends WHERE day < ?'

// ------------------------------------------------------- the owner's buttons

export const REVIEW_OPS = ['approve', 'delete']
const TAP_KEYS = new Set(['op', 'id'])

/** Check one tap from /my-admin/reviews. Returns { value } or { error }. */
export function checkReviewTap(body) {
  const shape = strictKeys(body, TAP_KEYS)
  if (shape) return { error: shape }
  if (!REVIEW_OPS.includes(body.op)) return { error: 'op must be approve or delete' }
  if (!Number.isSafeInteger(body.id) || body.id <= 0) return { error: 'id must be a positive whole number' }
  return { value: { op: body.op, id: body.id } }
}
