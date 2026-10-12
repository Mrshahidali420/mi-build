/**
 * "New title": a comic or novel that started in the last weeks and already
 * has an official English platform.
 *
 * Data: the record's start date (known to the day or the month) inside the
 * last NEW_DAYS, its kind, genres and platforms. One post per title. Only a
 * series that is still coming out counts: a one-shot, a bonus or special
 * chapter and a side story are not a new series, whatever their date.
 *
 * There is no "new volume" post: the catalog holds a volume COUNT, never a
 * volume's release date, so a new volume cannot be told from an old one.
 *
 * Image: the accent colour as the page, the word NEW very large, the cover
 * whole with a dark frame, the facts as labelled lines beside it (when it
 * started, what it is, genre, status, score, alt title, where to read it).
 */
import { clip, fitSize, listOf } from '../text.mjs'
import { DAY_MS, MONTHS } from '../when.mjs'
import { INNER } from '../render/parts.mjs'
import { byPopularity, ctaOf, keyFacts, onPlatform, single, statusWord, top, usable } from './shared.mjs'

export const NEW_DAYS = 75
export const MIN_POPULARITY = 300
/** The cover gives a little room to the line about the story when there is one. */
const COVER = { plain: { width: 466, height: 652 }, withLine: { width: 420, height: 588 } }
/** Names that mark a one-off chapter or a side piece, not a series. */
const ONE_OFF = /\b(one[- ]?shot|special|bonus|extra|omake|side[- ]story|gaiden|pilot|anthology|prologue|epilogue)\b/i

/** A series still coming out: not a one-shot by format, not a one-off by name. */
export const isSeries = (t) => t.status === 'RELEASING' && t.format !== 'ONE_SHOT' && !ONE_OFF.test(t.title)
const CTA = 'Where to read it from chapter one: link in the first comment'
const FRAME = 8

/** The start date as a moment (the first of the month when only the month is known), or null. */
function startedAt(t) {
  const s = t.start
  if (!s || !s.month || s.precision === 'year') return null
  return Date.UTC(s.year, s.month - 1, s.precision === 'day' && s.day ? s.day : 1)
}

const isNew = (t, now) => {
  const at = startedAt(t)
  return at !== null && at <= now && at >= now - NEW_DAYS * DAY_MS
}

const article = (noun) => (/^[aeiou]/i.test(noun) ? 'an' : 'a')

function toPost(title) {
  const started = `${MONTHS[title.start.month - 1]} ${title.start.year}`
  return {
    ...single(title),
    item: String(title.id),
    label: 'Where to read it',
    facts: keyFacts(title),
    noun: title.noun,
    started,
    genres: top(title.genres),
    sites: top(title.platforms),
    art: { hero: title.image },
    view: {
      title: clip(title.title, 80),
      tagline: title.tagline,
      // The labelled lines, in reading order; one the record lacks is left out.
      lines: [['Started', started], ['What it is', title.noun], ['Genre', top(title.genres).join(' · ')], ['Status', statusWord(title)], ['Score', title.rating && `${title.rating} on AniList`], ['Alt title', title.alt && clip(title.alt, 40)], ['Read it on', top(title.platforms).map((s) => clip(s, 18)).join(', ')]].filter(([, value]) => value),
    },
  }
}

const find = (data, { now }) =>
  data.titles
    .filter((t) => t.verb === 'read' && isSeries(t) && isNew(t, now) && t.popularity >= MIN_POPULARITY && usable(t))
    .sort(byPopularity)
    .map(toPost)

const captions = [
  (p) => ({ hook: `🆕 New on the shelf: ${p.title}.`, facts: [`You can read it on ${listOf(p.sites)}.`, `It is ${article(p.noun)} ${p.noun} that started in ${p.started}.`, ...p.facts], cta: ctaOf('read', 0) }),
  (p) => ({ hook: `🚨 New series alert 🚨 ${p.title} started in ${p.started}.`, facts: [`It is ${article(p.noun)} ${p.noun}, and it is on ${listOf(p.sites)}.`, ...p.facts], cta: ctaOf('read', 1) }),
  (p) => ({ hook: `✨ Just started: ${p.title}.`, facts: [`Read this ${p.noun} on ${listOf(p.sites)}.`, ...p.facts], cta: ctaOf('read', 2) }),
]

const questions = [(p) => `Have you started ${p.title} yet?`, (p) => onPlatform(p, 'Are you reading'), (p) => `Is ${p.title} going on your reading list?`]

function fact([label, value], k, t, roomy) {
  return k.col({ borderTop: `3px solid ${t.ink}`, paddingTop: roomy ? 12 : 8, paddingBottom: roomy ? 18 : 10 }, k.kicker(label, { color: t.soft, fontSize: roomy ? 21 : 19, letterSpacing: 3 }), k.display({ ...k.clamp(2), fontSize: (roomy ? 38 : 30) - (value.length > 20 ? 6 : 0), lineHeight: 1.08, marginTop: 3 }, value))
}

function template(v, k) {
  const t = k.tone('accent')
  const roomy = v.lines.length <= 5
  const cover = v.tagline ? COVER.withLine : COVER.plain
  return k.page(
    t,
    { cta: CTA },
    k.row(
      { justifyContent: 'space-between', alignItems: 'flex-start', height: 200 },
      k.display({ fontSize: 250, fontWeight: k.f.displayBlack, lineHeight: 0.8, marginLeft: -10, marginTop: 4 }, 'NEW'),
      k.kicker('Just started', { color: t.ink }),
    ),
    k.row(
      { marginTop: 24, height: cover.height + FRAME * 2 },
      k.box({ padding: FRAME, backgroundColor: t.ink, alignSelf: 'flex-start' }, k.art(v.art.hero, cover.width, cover.height)),
      k.col(
        { marginLeft: 40, width: INNER - cover.width - FRAME * 2 - 40, justifyContent: 'flex-end' },
        v.lines.map((line) => fact(line, k, t, roomy)),
      ),
    ),
    k.display({ ...k.clamp(2), fontSize: fitSize(v.title, [[16, 80], [30, 64], [50, 52], [80, 44]]), fontWeight: k.f.displayBlack, lineHeight: 1.02, marginTop: 26, maxWidth: INNER }, v.title),
    k.tagline(v.tagline, t, { marginTop: 10 }),
    k.fill(),
  )
}

export default { key: 'new-title', name: 'New title', urgent: false, gapDays: 300, titleGap: false, window: 6, find, captions, questions, tags: (p) => p.tags, template }
