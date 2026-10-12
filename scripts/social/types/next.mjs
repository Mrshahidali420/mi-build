/**
 * "What to read next": three titles AniList readers recommend to people who
 * liked one popular title.
 *
 * Data: the record's own recommendations (AniList users'), kept only when
 * the recommended title is itself on the site with an official platform.
 * It needs three of them, each with a large cover. The title then rests for
 * the 30-day title gap.
 *
 * Image: the title you liked, small, at the top; READ NEXT; three covers
 * side by side with their names.
 */
import { isSmallCover } from '../image.mjs'
import { clip, isDrawable, listOf } from '../text.mjs'
import { INNER } from '../render/parts.mjs'
import { interleave } from '../source.mjs'
import { usable } from './shared.mjs'

export const MIN_POPULARITY = 5000
export const RECS = 3
const GAP = 30
const CELL = Math.floor((INNER - GAP * (RECS - 1)) / RECS)
const COVER_HEIGHT = 392
const LIKED = { width: 150, height: 212 }

const goodRec = (rec) => rec.image && !isSmallCover(rec.image) && isDrawable(rec.title) && rec.section !== 'anime'

function toPost(title) {
  const recs = title.recs.filter(goodRec).slice(0, RECS)
  return {
    item: String(title.id),
    title: title.title,
    path: title.path,
    label: 'Where to read it, and more like it',
    tags: [title.section, title.genres[0]],
    names: recs.map((r) => r.title),
    art: { hero: title.image, thumbs: recs.map((r) => r.image) },
    view: { title: clip(title.title, 56), recs: recs.map((r) => ({ title: clip(r.title, 44) })) },
  }
}

const find = (data) =>
  interleave(data.titles.filter((t) => t.verb === 'read' && t.popularity >= MIN_POPULARITY && usable(t) && t.recs.filter(goodRec).length >= RECS)).map(toPost)

const captions = [
  (p) => [`Finished ${p.title}?`, `Readers on AniList recommend ${listOf(p.names)} next.`],
  (p) => [`If you liked ${p.title}, readers on AniList also recommend ${listOf(p.names)}.`],
  (p) => [`What to read after ${p.title}: ${listOf(p.names)}.`, 'All three are picks from AniList readers.'],
]

function template(v, k) {
  const t = k.tone('dark')
  return k.page(
    t,
    k.row(
      { alignItems: 'flex-end', height: LIKED.height },
      k.art(v.art.hero, LIKED.width, LIKED.height),
      k.col({ marginLeft: 30, width: INNER - LIKED.width - 30 }, k.kicker('If you liked', { color: t.soft }), k.display({ ...k.clamp(3), fontSize: v.title.length > 26 ? 44 : 58, lineHeight: 1.04, marginTop: 8 }, v.title)),
    ),
    k.display({ fontSize: 178, fontWeight: k.f.displayBlack, lineHeight: 0.9, color: t.pop, marginTop: 44, marginLeft: -6 }, 'READ NEXT'),
    k.rule(t.line, 2, { marginTop: 18 }),
    k.row(
      { marginTop: 30 },
      v.recs.map((rec, i) =>
        k.col(
          { width: CELL, marginRight: i < v.recs.length - 1 ? GAP : 0 },
          k.box({ width: CELL, height: COVER_HEIGHT, alignItems: 'flex-end' }, k.art(v.art.thumbs[i], CELL, COVER_HEIGHT)),
          k.display({ ...k.clamp(2), fontSize: 32, lineHeight: 1.06, marginTop: 14 }, rec.title),
        ),
      ),
    ),
    k.fill(),
  )
}

export default { key: 'next', name: 'What to read next', urgent: false, gapDays: 60, titleGap: true, window: 200, find, captions, tags: (p) => p.tags, template }
