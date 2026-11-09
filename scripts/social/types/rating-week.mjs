/**
 * "Top-rated episodes of the week": once a week, the best IMDb scores of the
 * episodes that aired in the last seven days, one per show.
 *
 * Data: the day's IMDb snapshot (ratings/load.mjs): episodes aired in the
 * last WEEK_MS with at least MIN_VOTES votes, the best of each show, the top
 * MAX_ITEMS; it needs MIN_ITEMS. The post names no single title, so the
 * shows still get their own posts the same day.
 *
 * Image (the owner's reference: ALL ANIME AT ONCE): a short headline, then
 * one wide strip per episode: the picture across it, "S2.EP5" at the
 * bottom left, the title letter-spaced, and on the right the score huge
 * with a yellow "IMDb" tag, on a dark fade.
 */
import { tagOf, uniqueTags } from '../story.mjs'
import { clip } from '../text.mjs'
import { H, PAD, W } from '../render/parts.mjs'
import { MIN_VOTES, ratingsExtra } from '../ratings/load.mjs'
import { dateOf } from '../when.mjs'
import { ctaOf } from './shared.mjs'
import { linkOf } from './out-now.mjs'
import { FOOT_HEIGHT, IMDB_YELLOW, artOf, baseName, foot, img, ratedEpisodes, scoreText, shortEpisode } from './rating.mjs'

export const WEEK_MS = 7 * 86_400_000
export const MIN_ITEMS = 3
export const MAX_ITEMS = 4
const HEAD = 150
const GAP = 6
const SPACED_MAX = 26

function find(data, { now }) {
  const best = new Map()
  for (const row of ratedEpisodes(data, now)) {
    if (row.votes < MIN_VOTES || !(row.aired > now - WEEK_MS)) continue
    const held = best.get(row.titleId)
    if (!held || row.score > held.score) best.set(row.titleId, row)
  }
  const rows = [...best.values()].sort((x, y) => y.score - x.score || y.votes - x.votes).slice(0, MAX_ITEMS)
  if (rows.length < MIN_ITEMS) return []
  const lead = rows[0]
  return [
    {
      item: 'week',
      title: null,
      path: linkOf(lead.title).path,
      label: linkOf(lead.title).label,
      names: rows.map((r) => r.title.title),
      lead: { title: lead.title.title, episode: lead.ep, score: scoreText(lead.score) },
      tags: uniqueTags([...rows.slice(0, 2).map((r) => tagOf(r.title.title)), '#AnimeRatings']).filter((tag) => !/amazon/i.test(tag)).slice(0, 3),
      art: { frames: rows.map((r) => artOf(data, r.title, r.ep).hero) },
      view: {
        date: dateOf(now),
        items: rows.map((r) => ({ short: shortEpisode(r.title.title, r.ep), spaced: clip(baseName(r.title.title).toUpperCase(), SPACED_MAX), score: scoreText(r.score) })),
      },
    },
  ]
}

const captions = [
  (p) => ({ hook: '🔥👀 THE TOP-RATED ANIME EPISODES OF THE WEEK ON IMDb!', facts: [`${p.lead.title} episode ${p.lead.episode} leads with ${p.lead.score}/10.`], cta: ctaOf('first', 0) }),
  (p) => ({ hook: `⭐ ${p.lead.title.toUpperCase()} TOPS THIS WEEK'S EPISODE RATINGS!`, facts: [`Episode ${p.lead.episode} holds ${p.lead.score}/10 on IMDb.`], cta: ctaOf('first', 1) }),
  (p) => ({ hook: `📈 THIS WEEK'S BEST ANIME EPISODES, BY IMDb SCORE!`, facts: [`${p.names.length} shows made the list.`], cta: ctaOf('first', 2) }),
]

const questions = [() => "💬 Which anime stole the spotlight with this week's standout episode?", () => '💬 Which of these was your episode of the week?', () => '💬 Which score would you change?']

/** One strip: the picture, the dark fade on the right, the words over it. */
function strip(k, t, picture, item, height) {
  return k.box(
    { width: W, height, position: 'relative', overflow: 'hidden', backgroundColor: k.theme.color.raised },
    picture ? img(picture, W, height) : null,
    k.box({ position: 'absolute', top: 0, left: 0, width: W, height, backgroundImage: `linear-gradient(to right, rgba(0,0,0,0.05) 35%, ${t.bg} 74%)` }),
    k.col(
      { position: 'absolute', left: 24, bottom: 14 },
      k.body({ fontSize: 20, fontWeight: k.f.textBold, color: '#FFFFFF', letterSpacing: 5, textShadow: '0 2px 8px rgba(0,0,0,0.9)', whiteSpace: 'nowrap' }, item.spaced),
      k.display({ marginTop: 4, fontSize: 64, fontWeight: k.f.displayBlack, color: '#FFFFFF', lineHeight: 1, textShadow: '0 3px 12px rgba(0,0,0,0.85)' }, item.short),
    ),
    k.col(
      { position: 'absolute', right: 30, top: 0, height, justifyContent: 'center', alignItems: 'flex-end' },
      k.row({ alignItems: 'flex-end' }, k.display({ fontSize: 124, fontWeight: k.f.displayBlack, color: '#FFFFFF', lineHeight: 0.9, letterSpacing: -4 }, item.score), k.display({ fontSize: 38, fontWeight: k.f.displayBlack, color: '#FFFFFF', marginLeft: 6, marginBottom: 6 }, '/10')),
      k.display({ marginTop: 10, fontSize: 30, fontWeight: k.f.displayBlack, color: '#000000', backgroundColor: IMDB_YELLOW, paddingTop: 4, paddingBottom: 2, paddingLeft: 12, paddingRight: 12, borderRadius: 6 }, 'IMDb'),
    ),
  )
}

function template(v, k) {
  const t = k.tone('dark')
  const count = v.items.length
  const height = Math.floor((H - HEAD - FOOT_HEIGHT - GAP * (count - 1)) / count)
  return k.box(
    { width: W, height: H, backgroundColor: t.bg, color: t.ink, fontFamily: k.f.text, flexDirection: 'column', position: 'relative' },
    k.col(
      { width: W - PAD * 2, marginLeft: PAD, height: HEAD, justifyContent: 'center' },
      k.row(
        { alignItems: 'baseline' },
        k.display({ fontSize: 60, fontWeight: k.f.displayBlack, lineHeight: 1 }, 'EPISODES OF THE WEEK'),
      ),
      k.row({ alignItems: 'baseline', marginTop: 8 }, k.display({ fontSize: 30, color: t.soft, letterSpacing: 2 }, 'RATED ON'), k.display({ fontSize: 30, fontWeight: k.f.displayBlack, color: IMDB_YELLOW, marginLeft: 10 }, 'IMDb')),
    ),
    k.col({ width: W }, v.items.map((item, i) => k.box({ marginTop: i ? GAP : 0 }, strip(k, t, v.art.frames?.[i], item, height)))),
    foot(k, t, 'Start with #1: link in the first comment'),
  )
}

export default { key: 'rating-week', name: 'Top-rated episodes of the week', urgent: true, gapDays: 7, titleGap: false, window: 1, find, captions, questions, tags: (p) => p.tags, template, extra: ratingsExtra }
