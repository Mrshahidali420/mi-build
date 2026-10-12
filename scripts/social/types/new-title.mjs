/**
 * "New title": a comic or novel that started in the last weeks and already
 * has an official English platform.
 *
 * Data: the record's start date (known to the day or the month) inside the
 * last NEW_DAYS, its kind, genres and platforms. One post per title.
 *
 * There is no "new volume" post: the catalog holds a volume COUNT, never a
 * volume's release date, so a new volume cannot be told from an old one.
 *
 * Image: the accent colour as the page, the word NEW very large, the cover
 * whole with a dark frame, the facts as plain lines beside it.
 */
import { clip, fitSize, listOf } from '../text.mjs'
import { DAY_MS, MONTHS } from '../when.mjs'
import { INNER } from '../render/parts.mjs'
import { byPopularity, top, usable } from './shared.mjs'

export const NEW_DAYS = 75
export const MIN_POPULARITY = 300
const COVER = { width: 500, height: 700 }
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
    item: String(title.id),
    title: title.title,
    path: title.path,
    label: 'Where to read it',
    tags: [title.section, title.genres[0]],
    noun: title.noun,
    started,
    genres: top(title.genres),
    sites: top(title.platforms),
    art: { hero: title.image },
    view: { title: clip(title.title, 80), started, noun: title.noun, genres: top(title.genres).join(', '), sites: top(title.platforms).map((s) => clip(s, 18)) },
  }
}

const find = (data, { now }) =>
  data.titles
    .filter((t) => t.verb === 'read' && (t.status === 'RELEASING' || t.status === 'FINISHED') && isNew(t, now) && t.popularity >= MIN_POPULARITY && usable(t))
    .sort(byPopularity)
    .map(toPost)

const genreLine = (p) => (p.genres.length ? `Genres: ${listOf(p.genres)}.` : null)

const captions = [
  (p) => [`New on the shelf: ${p.title}, ${article(p.noun)} ${p.noun} that started in ${p.started}.`, `You can read it on ${listOf(p.sites)}.`, genreLine(p)],
  (p) => [`${p.title} started in ${p.started}.`, `It is ${article(p.noun)} ${p.noun}, and it is on ${listOf(p.sites)}.`],
  (p) => [`Just started: ${p.title}.`, `Read this ${p.noun} on ${listOf(p.sites)}.`, genreLine(p)],
]

function fact(label, value, k, t) {
  return k.col({ borderTop: `3px solid ${t.ink}`, paddingTop: 12, paddingBottom: 20 }, k.kicker(label, { color: t.soft, fontSize: 21, letterSpacing: 3 }), k.display({ ...k.clamp(2), fontSize: value.length > 18 ? 32 : 40, lineHeight: 1.08, marginTop: 4 }, value))
}

function template(v, k) {
  const t = k.tone('accent')
  return k.page(
    t,
    k.row(
      { justifyContent: 'space-between', alignItems: 'flex-start', height: 232 },
      k.display({ fontSize: 290, fontWeight: k.f.displayBlack, lineHeight: 0.8, marginLeft: -12, marginTop: 6 }, 'NEW'),
      k.kicker('Just started', { color: t.ink }),
    ),
    k.row(
      { marginTop: 26, height: COVER.height + FRAME * 2 },
      k.box({ padding: FRAME, backgroundColor: t.ink, alignSelf: 'flex-start' }, k.art(v.art.hero, COVER.width, COVER.height)),
      k.col(
        { marginLeft: 40, width: INNER - COVER.width - FRAME * 2 - 40, justifyContent: 'flex-end' },
        fact('Started', v.started, k, t),
        fact('What it is', v.noun, k, t),
        v.genres && fact('Genres', v.genres, k, t),
        v.sites.length > 0 && fact('Read it on', v.sites.join(', '), k, t),
      ),
    ),
    k.display({ ...k.clamp(2), fontSize: fitSize(v.title, [[16, 88], [30, 70], [50, 56], [80, 46]]), fontWeight: k.f.displayBlack, lineHeight: 1.02, marginTop: 28, maxWidth: INNER }, v.title),
    k.fill(),
  )
}

export default { key: 'new-title', name: 'New title', urgent: false, gapDays: 300, titleGap: false, window: 6, find, captions, tags: (p) => p.tags, template }
