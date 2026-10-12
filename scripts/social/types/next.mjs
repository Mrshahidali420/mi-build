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
import { aboutOf, ctaOf, keyFacts, single, usable } from './shared.mjs'

export const MIN_POPULARITY = 5000
export const RECS = 3
const GAP = 30
const CELL = Math.floor((INNER - GAP * (RECS - 1)) / RECS)
const COVER_HEIGHT = 430
const LIKED = { width: 176, height: 250 }
const CTA = 'Where to read it and more like it: link in the first comment'

const goodRec = (rec) => rec.image && !isSmallCover(rec.image) && isDrawable(rec.title) && rec.section !== 'anime'

function toPost(title) {
  const recs = title.recs.filter(goodRec).slice(0, RECS)
  return {
    ...single(title),
    item: String(title.id),
    label: 'Where to read it, and more like it',
    facts: keyFacts(title),
    names: recs.map((r) => r.title),
    art: { hero: title.image, thumbs: recs.map((r) => r.image) },
    view: { title: clip(title.title, 56), recs: recs.map((r) => ({ title: clip(r.title, 44) })), about: aboutOf(title, { genres: 2, status: false, alt: false }) },
  }
}

const find = (data) =>
  interleave(data.titles.filter((t) => t.verb === 'read' && t.popularity >= MIN_POPULARITY && usable(t) && t.recs.filter(goodRec).length >= RECS)).map(toPost)

const captions = [
  (p) => ({ hook: `📚 Finished ${p.title}? Here is what to read next.`, facts: [`Readers on AniList recommend ${listOf(p.names)}.`, ...p.facts], cta: ctaOf('read', 0) }),
  (p) => ({ hook: `👀 If you liked ${p.title}, try these three.`, facts: [`${listOf(p.names)}: all picks from AniList readers.`, ...p.facts], cta: ctaOf('read', 1) }),
  (p) => ({ hook: `🔥 What to read after ${p.title}.`, facts: [`${listOf(p.names)}.`, 'All three are picks from AniList readers.', ...p.facts], cta: ctaOf('read', 2) }),
]

const questions = [(p) => `Which of these three would you read after ${p.title}?`, (p) => `What would you recommend to a fan of ${p.title}?`, (p) => `Have you read ${p.title} and any of these?`]

function template(v, k) {
  const t = k.tone('dark')
  const side = INNER - LIKED.width - 30
  return k.page(
    t,
    { cta: CTA },
    k.row(
      { alignItems: 'flex-end', height: LIKED.height },
      k.art(v.art.hero, LIKED.width, LIKED.height),
      k.col({ marginLeft: 30, width: side }, k.kicker('If you liked', { color: t.soft }), k.display({ ...k.clamp(2), fontSize: v.title.length > 26 ? 42 : 56, lineHeight: 1.04, marginTop: 8 }, v.title), k.about(v.about, t, { size: 23, width: side, style: { marginTop: 12 } })),
    ),
    k.display({ fontSize: 150, fontWeight: k.f.displayBlack, lineHeight: 0.9, color: t.pop, marginTop: 34, marginLeft: -6, whiteSpace: 'nowrap' }, 'READ NEXT'),
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

export default { key: 'next', name: 'What to read next', urgent: false, gapDays: 60, titleGap: true, window: 200, find, captions, questions, tags: (p) => p.tags, template }
