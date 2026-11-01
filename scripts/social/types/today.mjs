/**
 * "Episodes out today": once a day, the most followed of today's new
 * episodes as one list, in order of air time.
 *
 * Data: the same list as the "Airing today" reel (reel-today.mjs: today's
 * episodes of anime made from comics, at least three). The post
 * names no single title, so each show still gets its own posts the same day
 * (out now, final episode). On Instagram it goes as a swipe post (reel-today
 * carries the slides).
 *
 * Image: a printed schedule. One row per show: the time, a small cover, the
 * title and the episode. Hairlines between rows, nothing else.
 */
import { INNER } from '../render/parts.mjs'
import { ctaOf, START_WITH_ONE } from './shared.mjs'
import reelToday from './reel-today.mjs'

/** Row heights: the space the rows share, and the least and most one row takes. */
const ROW = { space: 820, min: 132, max: 262, roomy: 186 }
/** The time column: "12:30 AM" fits on one line. */
const TIME_WIDTH = 210

const captions = [
  (p) => ({ hook: `🔥 ${p.total} NEW EPISODES ARE OUT TODAY!`, facts: [`${p.names[0]} leads the day.`], cta: ctaOf('first', 0) }),
  (p) => ({ hook: `📺 TODAY'S NEW EPISODES, IN ORDER OF AIR TIME!`, facts: [`${p.total} shows in all, ${p.view.date}.`], cta: ctaOf('first', 1) }),
  (p) => ({ hook: `🚨 NEW EPISODE DAY: ${p.names[0].toUpperCase()} AND MORE!`, facts: ['All times are US Eastern.'], cta: ctaOf('first', 2) }),
]

const questions = [() => '💬 Which one are you watching first?', (p) => `💬 Are you keeping up with ${p.names[0]}?`, () => '💬 Which of these is your pick of the day?']

/** Rows share the space under the headline: few rows are tall, six are compact. */
function rowSizes(count) {
  const height = Math.max(ROW.min, Math.min(ROW.max, Math.floor(ROW.space / count)))
  const roomy = height >= ROW.roomy
  const thumbHeight = height - 26
  return { height, thumb: { width: Math.round(thumbHeight * 0.71), height: thumbHeight }, time: roomy ? 40 : 32, title: roomy ? 40 : 34, long: roomy ? 32 : 28, note: roomy ? 26 : 22 }
}

function template(v, k) {
  const t = k.tone('dark')
  const size = rowSizes(v.items.length)
  return k.page(
    t,
    { cta: START_WITH_ONE },
    k.row({ justifyContent: 'space-between', alignItems: 'flex-end' }, k.kicker('New episodes', { color: t.pop }), k.kicker(v.date, { color: t.soft })),
    k.display({ fontSize: 80, fontWeight: k.f.displayBlack, lineHeight: 1, marginTop: 18 }, 'EPISODES'),
    k.display({ fontSize: 80, fontWeight: k.f.displayBlack, lineHeight: 1, color: t.pop }, 'OUT TODAY'),
    k.col(
      { marginTop: 26 },
      v.items.map((r, i) =>
        k.row(
          { alignItems: 'center', height: size.height, borderTop: `2px solid ${t.line}` },
          k.col({ width: TIME_WIDTH, flexShrink: 0 }, k.display({ fontSize: size.time, color: t.pop, whiteSpace: 'nowrap' }, r.time), k.body({ fontSize: size.note + 2, color: t.soft, marginTop: 4 }, 'ET')),
          k.box({ width: size.thumb.width, height: size.thumb.height, alignItems: 'center', justifyContent: 'center', marginRight: 30, flexShrink: 0 }, k.art(v.art.thumbs[i], size.thumb.width, size.thumb.height)),
          k.col(
            { width: INNER - TIME_WIDTH - size.thumb.width - 30 },
            k.display({ ...k.clamp(2), fontSize: r.title.length > 30 ? size.long : size.title, lineHeight: 1.12 }, r.title),
            r.note && k.body({ ...k.clamp(1), fontSize: size.note, color: t.soft, marginTop: 8 }, r.note),
          ),
        ),
      ),
    ),
    k.fill(),
  )
}

export default { key: 'today', name: 'Episodes out today', urgent: true, gapDays: 300, titleGap: false, window: 1, find: reelToday.find, captions, questions, tags: (p) => p.tags.slice(0, 3), template }
