/**
 * "Where to read": every official platform of one popular comic or novel.
 *
 * Data: the official reading links the title page lists (how many, and how
 * many are free to start), how much of the story is out, its score, genres,
 * status and other name. Titles are taken in turns by section, so manhwa is
 * not crowded out. The title then rests for the 30-day title gap.
 *
 * Image: the cover whole on the left; on the right the counted list of
 * platforms, how much is out, and the labelled lines (score, genre, status,
 * alt title). The title under both, and the line that points at the first
 * comment.
 */
import { clip, fitSize, listMore } from '../text.mjs'
import { INNER } from '../render/parts.mjs'
import { interleave } from '../source.mjs'
import { aboutOf, ctaOf, keyFacts, onPlatform, placeRows, placesColumn, placesHead, single, usable } from './shared.mjs'

export const MIN_POPULARITY = 5000
const COVER = { width: 500, height: 712 }
const SIDE = INNER - COVER.width - 40
const CTA = 'Every legal place to read it: link in the first comment'

function stateOf(t) {
  if (t.status === 'FINISHED') return t.chapters ? `It is completed at ${t.chapters} chapters.` : 'It is completed.'
  if (t.status === 'RELEASING') return 'It is ongoing.'
  if (t.status === 'HIATUS') return 'It is on hiatus.'
  return null
}

/** How much there is to read, as a figure and a line; only what the record states. The year when it states no count. */
function lengthOf(t) {
  const done = t.status === 'FINISHED'
  if (t.chapters) return { count: String(t.chapters), countLine: done ? 'chapters, completed' : 'chapters so far' }
  if (t.volumes) return { count: String(t.volumes), countLine: done ? 'volumes, completed' : 'volumes so far' }
  return t.year ? { count: String(t.year), countLine: t.noun, byYear: true } : { count: null, countLine: null }
}

function toPost(title) {
  const free = title.places.filter((p) => p.free).length
  const { rows, more } = placeRows(title.places)
  const { byYear, ...length } = lengthOf(title)
  return {
    ...single(title),
    item: String(title.id),
    label: 'Where to read it',
    state: stateOf(title),
    names: title.places.slice(0, 3).map((p) => p.site),
    total: title.places.length,
    free: free > 0 ? `${free} of them ${free === 1 ? 'is' : 'are'} free to start.` : null,
    facts: keyFacts(title),
    art: { hero: title.image },
    view: {
      title: clip(title.title, 80),
      head: placesHead(title.places.length, free),
      sites: rows,
      more,
      ...length,
      about: aboutOf(title),
      meta: [title.noun, !byYear && title.year].filter(Boolean).join(' · '),
    },
  }
}

const find = (data) => interleave(data.titles.filter((t) => t.verb === 'read' && t.popularity >= MIN_POPULARITY && usable(t))).map(toPost)

const sites = (p) => listMore(p.names, p.total)

const captions = [
  (p) => ({ hook: `📖 Where can you read ${p.title} legally?`, facts: [`It is on ${sites(p)}.`, p.free, p.state, ...p.facts], cta: ctaOf('read', 0) }),
  (p) => ({ hook: `🔎 Looking for ${p.title}? Here is every official platform.`, facts: [`Official platforms: ${sites(p)}.`, p.free, p.state, ...p.facts], cta: ctaOf('read', 1) }),
  (p) => ({ hook: `📚 ${p.title}: where to read it, officially.`, facts: [`You can read it on ${sites(p)}.`, p.state, p.free, ...p.facts], cta: ctaOf('read', 2) }),
]

const questions = [(p) => `Have you read ${p.title} yet?`, (p) => onPlatform(p, 'Are you following'), (p) => `Would you recommend ${p.title} to a friend?`]

function template(v, k) {
  const t = k.tone('dark')
  return k.page(
    t,
    { cta: CTA },
    k.row({ justifyContent: 'space-between', alignItems: 'flex-end' }, k.kicker('Where to read', { color: t.pop }), k.kicker(v.meta, { color: t.soft, fontSize: 22, letterSpacing: 3 })),
    k.rule(t.line, 2, { marginTop: 20 }),
    k.row(
      { marginTop: 32, height: COVER.height, justifyContent: 'space-between' },
      k.box({ width: COVER.width, height: COVER.height, alignItems: 'flex-start' }, k.art(v.art.hero, COVER.width, COVER.height)),
      placesColumn(v, k, t, { width: SIDE, height: COVER.height }),
    ),
    k.display({ ...k.clamp(2), fontSize: fitSize(v.title, [[14, 88], [24, 72], [40, 58], [80, 44]]), fontWeight: k.f.displayBlack, lineHeight: 1.02, marginTop: 30, maxWidth: INNER }, v.title),
    k.fill(),
  )
}

export default { key: 'where', name: 'Where to read', urgent: false, gapDays: 30, titleGap: true, window: 300, find, captions, questions, tags: (p) => p.tags, samples: (posts) => [posts.find((p) => p.total === 1), posts.find((p) => p.total >= 4)], template }
