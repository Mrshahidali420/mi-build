/**
 * Facebook captions for the Page poster, one builder per format.
 *
 * The rules (owner, 12 Oct 2026):
 *   - every sentence comes from a fact on the record; a fact the record lacks
 *     is left out, never guessed or padded
 *   - the title appears once, 2 to 4 short sentences, at most 2 hashtags,
 *     no emoji, no link (the link goes in the first comment), no Amazon
 *   - no synonym-swap spinning: one fixed wording per fact
 *
 * A builder returns the caption text, or null when the record lacks the facts
 * that format needs. checkCaption() is the last gate; a caption that fails it
 * is dropped, never posted.
 *
 * Candidate shape (made by source.mjs): { title, verb: 'read'|'watch',
 * section, noun, year, endYear, status, chapters, episodes, score, genres,
 * platforms, studio, nextEpisode: { number, at }, recs: [{ title }], blocked }
 */

export const MAX_CAPTION = 420
export const MAX_HASHTAGS = 2
export const MAX_SENTENCES = 4

/** Format -> mix. NEW is news (an episode today, a series still running); OLD is evergreen. */
export const FORMATS = { airing: 'new', running: 'new', where: 'old', facts: 'old', like: 'old' }

export const join = (list) =>
  list.length <= 1 ? list.join('') : list.length === 2 ? `${list[0]} and ${list[1]}` : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`

const a = (word) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`)
const top = (list, n = 3) => (list || []).slice(0, n)

/** "today at 7:30 PM ET", "tomorrow at 9:00 AM ET", or null when further out. */
export function airWhen(at, now, timeZone = 'America/New_York') {
  const day = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(ms))
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(at))
  if (day(at) === day(now)) return `today at ${time} ET`
  if (day(at) === day(now + 86_400_000)) return `tomorrow at ${time} ET`
  return null
}

function genreLine(c) {
  const g = top(c.genres, 3)
  return g.length ? `Genres: ${join(g)}.` : null
}

function platformLine(c) {
  const p = top(c.platforms, 3)
  if (!p.length) return null
  return c.verb === 'watch' ? `It streams on ${join(p)}.` : `You can read it on ${join(p)}.`
}

const BUILDERS = {
  /** An anime episode airing today or tomorrow. */
  airing(c, now) {
    const ep = c.nextEpisode
    if (c.verb !== 'watch' || !ep?.number || !ep.at || ep.at <= now) return null
    const when = airWhen(ep.at, now)
    if (!when) return null
    return [`Episode ${ep.number} of ${c.title} is set to air ${when}.`, platformLine(c), c.studio ? `Animation by ${c.studio}.` : genreLine(c)]
  },

  /** A series that is still coming out. */
  running(c) {
    if (c.status !== 'RELEASING') return null
    const first =
      c.verb === 'watch'
        ? c.nextEpisode?.number
          ? `${c.title} is airing now, with episode ${c.nextEpisode.number} up next.`
          : `${c.title} is airing now.`
        : c.chapters
          ? `${c.title} is still coming out, with ${c.chapters} chapters so far.`
          : `${c.title} is still ongoing.`
    const since = c.year ? `It started in ${c.year}.` : null
    return [first, platformLine(c), since, genreLine(c)]
  },

  /** Where to read or watch it, officially. */
  where(c) {
    const p = top(c.platforms, 3)
    if (!p.length) return null
    const first = `Where to ${c.verb} ${c.title}? Officially on ${join(p)}.`
    let state = null
    if (c.status === 'FINISHED') {
      if (c.verb === 'watch' && c.episodes > 1) state = `All ${c.episodes} episodes are out.`
      else if (c.verb === 'read' && c.chapters) state = `The story is complete at ${c.chapters} chapters.`
      else state = 'The story is complete.'
    } else if (c.status === 'RELEASING') state = 'It is still coming out.'
    return [first, state, genreLine(c)]
  },

  /** The record's plain facts. */
  facts(c) {
    if (!c.year || !c.noun) return null
    const first = `${c.title} is ${a(c.noun)} from ${c.year}.`
    const score = c.score ? `Its average score on AniList is ${c.score}%.` : null
    let size = null
    if (c.verb === 'read' && c.status === 'FINISHED' && c.chapters && c.endYear) size = `It ran for ${c.chapters} chapters and ended in ${c.endYear}.`
    else if (c.verb === 'watch' && c.episodes > 1) size = `It has ${c.episodes} episodes${c.studio ? `, made by ${c.studio}` : ''}.`
    if (!score && !size) return null
    return [first, score, size, genreLine(c)]
  },

  /** "X like Y": AniList users' own recommendations. */
  like(c) {
    const recs = (c.recs || []).map((r) => r.title).filter(Boolean)
    if (recs.length < 2) return null
    const who = c.verb === 'watch' ? 'fans' : 'readers'
    return [`If you liked ${c.title}, ${who} on AniList also recommend ${join(recs.slice(0, 3))}.`, platformLine(c)]
  },
}

/** Two hashtags at most: the section, then the first genre. */
export function hashtagsOf(c) {
  const tags = [c.section, c.genres?.[0]]
    .filter(Boolean)
    .map((t) => `#${String(t).toLowerCase().replace(/[^a-z0-9]/g, '')}`)
    .filter((t) => t.length > 1)
  return [...new Set(tags)].slice(0, MAX_HASHTAGS)
}

const count = (text, needle) => {
  if (!needle) return 0
  const hay = text.toLowerCase()
  const n = needle.toLowerCase()
  let found = 0
  for (let i = hay.indexOf(n); i !== -1; i = hay.indexOf(n, i + n.length)) found += 1
  return found
}

/** Why a caption may not be posted, or null when it may. */
export function checkCaption(text, c, blockedTags = []) {
  if (!text) return 'empty'
  if (text.length > MAX_CAPTION) return 'too long'
  if (count(text, c.title) !== 1) return 'title must appear exactly once'
  if (/https?:\/\/|www\./i.test(text)) return 'link in the caption'
  if (/amazon|affiliate|\bAI\b/i.test(text)) return 'forbidden word'
  if (/\p{Extended_Pictographic}/u.test(text)) return 'emoji'
  if ((text.match(/#/g) || []).length > MAX_HASHTAGS) return 'too many hashtags'
  if (/\{[^}]*\|[^}]*\}/.test(text)) return 'spin syntax'
  // Titles like "Dr. STONE" carry their own full stops; count without them.
  const body = text.split('\n')[0].split(c.title).join('TITLE')
  const sentences = body.split(/(?<=[.?!])\s+/).filter(Boolean).length
  if (sentences < 2 || sentences > MAX_SENTENCES) return 'needs 2 to 4 sentences'
  for (const tag of blockedTags) if (new RegExp(`\\b${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) return `blocked word: ${tag}`
  return null
}

/** The caption for one format, or null. */
export function buildCaption(format, c, now, blockedTags = []) {
  const make = BUILDERS[format]
  if (!make || !c?.title) return null
  const lines = make(c, now)
  if (!lines) return null
  const sentences = lines.filter(Boolean).slice(0, MAX_SENTENCES)
  const tags = hashtagsOf(c)
  const text = sentences.join(' ') + (tags.length ? `\n\n${tags.join(' ')}` : '')
  return checkCaption(text, c, blockedTags) ? null : text
}
