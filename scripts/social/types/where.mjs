/**
 * "Where to read": the official platforms of one popular comic or novel.
 *
 * Data: the record's official English or worldwide reading links and how
 * much of the story is out. Titles are taken in turns by section, so manhwa
 * is not crowded out. The title then rests for the 30-day title gap.
 *
 * Image: the platforms as a numbered list on the left, the cover whole on
 * the right, the title under both.
 */
import { clip, fitSize, listOf } from '../text.mjs'
import { INNER } from '../render/parts.mjs'
import { interleave } from '../source.mjs'
import { top, usable } from './shared.mjs'

export const MIN_POPULARITY = 5000
const MAX_SITES = 4
const COVER = { width: 540, height: 780 }
const TITLE_STEPS = [[14, 96], [26, 78], [44, 62], [70, 50], [90, 42]]

function stateOf(t) {
  if (t.status === 'FINISHED') return t.chapters ? `The story is complete at ${t.chapters} chapters.` : 'The story is complete.'
  if (t.status === 'RELEASING') return 'It is still coming out.'
  return null
}

const metaOf = (t) => [t.noun, t.year].filter(Boolean).join(' · ')

/** How much there is to read, as a figure and a line; only what the record states. */
function lengthOf(t) {
  const done = t.status === 'FINISHED'
  if (t.chapters) return { count: String(t.chapters), countLine: done ? 'chapters, complete' : 'chapters so far' }
  if (t.volumes) return { count: String(t.volumes), countLine: done ? 'volumes, complete' : 'volumes so far' }
  return { count: null, countLine: done ? 'The story is complete' : t.status === 'RELEASING' ? 'Still coming out' : null }
}

function toPost(title) {
  return {
    item: String(title.id),
    title: title.title,
    path: title.path,
    label: 'Where to read it',
    tags: [title.section, title.genres[0]],
    state: stateOf(title),
    art: { hero: title.image },
    view: { title: clip(title.title, 90), sites: top(title.platforms, MAX_SITES).map((s) => clip(s, 30)), meta: metaOf(title), ...lengthOf(title) },
  }
}

const find = (data) => interleave(data.titles.filter((t) => t.verb === 'read' && t.popularity >= MIN_POPULARITY && usable(t))).map(toPost)

const sites = (p) => listOf(top(p.view.sites))

const captions = [
  (p) => [`Where to read ${p.title}? Officially on ${sites(p)}.`, p.state],
  (p) => [`${p.title} is on ${sites(p)}, officially.`, p.state],
  (p) => [`Looking for ${p.title}?`, `You can read it on ${sites(p)}.`, p.state],
]

function template(v, k) {
  const t = k.tone('dark')
  return k.page(
    t,
    k.row({ justifyContent: 'space-between' }, k.kicker('Where to read', { color: t.pop }), k.kicker(v.meta, { color: t.soft, fontSize: 22, letterSpacing: 3 })),
    k.rule(t.line, 2, { marginTop: 20 }),
    k.row(
      { marginTop: 34, height: COVER.height, justifyContent: 'space-between' },
      k.col(
        { width: INNER - COVER.width - 40, justifyContent: 'space-between' },
        k.col(
          {},
          v.sites.map((site, i) =>
            k.col(
              { borderBottom: `2px solid ${t.line}`, paddingTop: i ? 18 : 0, paddingBottom: 18 },
              k.display({ fontSize: 28, color: t.pop, fontWeight: k.f.displayBlack }, String(i + 1).padStart(2, '0')),
              k.display({ ...k.clamp(2), fontSize: site.length > 11 ? 40 : 54, fontWeight: k.f.displayBlack, textTransform: 'uppercase', lineHeight: 1.02, marginTop: 2 }, site),
            ),
          ),
        ),
        v.sites.length <= 3 &&
          k.col(
            {},
            v.count && k.display({ fontSize: fitSize(v.count, [[2, 170], [3, 150], [4, 118]]), fontWeight: k.f.displayBlack, lineHeight: 0.9, marginLeft: -4 }, v.count),
            v.countLine && k.body({ fontSize: 30, color: t.soft, marginTop: 8 }, v.countLine),
          ),
      ),
      k.box({ width: COVER.width, justifyContent: 'flex-end', alignItems: 'flex-start' }, k.art(v.art.hero, COVER.width, COVER.height)),
    ),
    k.display({ ...k.clamp(3), fontSize: fitSize(v.title, TITLE_STEPS), fontWeight: k.f.displayBlack, lineHeight: 1.02, marginTop: 34, maxWidth: INNER }, v.title),
    k.fill(),
  )
}

export default { key: 'where', name: 'Where to read', urgent: false, gapDays: 30, titleGap: true, window: 300, find, captions, tags: (p) => p.tags, template }
