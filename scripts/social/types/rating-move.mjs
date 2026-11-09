/**
 * "Rating on the move": an episode we posted the rating of whose IMDb
 * score has since gone up or down by MOVE or more. Once per episode and
 * direction.
 *
 * Data: the day's IMDb snapshot (ratings/load.mjs); `base` is the score on
 * the day of our rating post.
 *
 * Image: the rating card with two scores, "9.8 ↑ 9.9": the old one in a
 * dark box, an arrow (green up, red down), the new one in a box lit in the
 * arrow's colour.
 */
import { MIN_VOTES, MOVE, ratingsExtra } from '../ratings/load.mjs'
import { ctaFor } from './out-now.mjs'
import { DOWN, UP, card, episodeLine, ratedEpisodes, ratingLabel, ratingPost, scoreMark, scoreText, votesText } from './rating.mjs'

/** The rounding IMDb shows: a move is counted on the shown scores. */
const shown = (score) => Math.round(score * 10) / 10

/** Up, down, or null: the change since our rating post, when it is news. */
export function moveOf(row) {
  if (row.base == null || row.votes < MIN_VOTES) return null
  const change = shown(row.score) - shown(row.base)
  if (Math.abs(change) < MOVE - 1e-9) return null
  return change > 0 ? 'up' : 'down'
}

function find(data, { now }) {
  return ratedEpisodes(data, now)
    .map((row) => ({ row, move: moveOf(row) }))
    .filter(({ move }) => move)
    .sort((x, y) => Math.abs(y.row.score - y.row.base) - Math.abs(x.row.score - x.row.base))
    .map(({ row, move }) => ratingPost(data, row, { item: `${row.id}:${move}`, move, before: scoreText(row.base), view: { ...ratingPost(data, row).view, move, before: scoreText(row.base) } }))
}

const loud = (p) => p.title.toUpperCase()

const captions = [
  (p) => (p.move === 'up' ? { hook: `🔥📈 ${loud(p)} EPISODE ${p.episode} CLIMBS FROM ${p.before} TO ${p.score}/10 ON IMDb!`, facts: [`Now rated by ${votesText(p.votes)} viewers.`], cta: ctaFor(p, 0) } : { hook: `📉 ${loud(p)} EPISODE ${p.episode} SLIPS FROM ${p.before} TO ${p.score}/10 ON IMDb.`, facts: [`Now rated by ${votesText(p.votes)} viewers.`], cta: ctaFor(p, 0) }),
  (p) => ({ hook: `${p.move === 'up' ? '⭐' : '👀'} THE IMDb SCORE OF ${loud(p)} EPISODE ${p.episode} IS NOW ${p.score}/10!`, facts: [`It was ${p.before} when we first posted it.`], cta: ctaFor(p, 1) }),
  (p) => ({ hook: `${p.move === 'up' ? '🚀' : '👀'} ${loud(p)} EPISODE ${p.episode}: ${p.before} THEN, ${p.score}/10 NOW ON IMDb!`, facts: [`${votesText(p.votes)} votes so far.`], cta: ctaFor(p, 2) }),
]

const questions = [(p) => (p.move === 'up' ? `💬 Is episode ${p.episode} worthy of a perfect 10?` : `💬 Did episode ${p.episode} live up to the hype?`), (p) => `💬 What would you give episode ${p.episode}?`, (p) => `💬 Is the new score fair for episode ${p.episode}?`]

/** The arrow: a bar under a triangle, pointing up or down. */
function arrow(k, move) {
  const color = move === 'up' ? UP : DOWN
  const head = move === 'up' ? { borderLeft: '42px solid transparent', borderRight: '42px solid transparent', borderBottom: `52px solid ${color}` } : { borderLeft: '42px solid transparent', borderRight: '42px solid transparent', borderTop: `52px solid ${color}` }
  const bar = k.box({ width: 34, height: 70, backgroundColor: color })
  const tip = k.box({ width: 0, height: 0, ...head })
  return k.col({ alignItems: 'center', marginLeft: 26, marginRight: 26 }, ...(move === 'up' ? [tip, bar] : [bar, tip]))
}

/** One score in its box; the new one lit in the arrow's colour. */
const scoreBox = (k, t, score, lit) =>
  k.box(
    { paddingTop: 18, paddingBottom: 16, paddingLeft: 30, paddingRight: 26, borderRadius: 26, backgroundColor: '#000000', border: `5px solid ${lit || t.ink}`, boxShadow: lit ? `0 0 34px ${lit}` : 'none' },
    scoreMark(k, t.ink, score, 150),
  )

function template(v, k) {
  const t = k.tone('dark')
  const lit = v.move === 'up' ? UP : DOWN
  const head = [
    ratingLabel(k, t),
    k.row({ marginTop: 22, alignItems: 'center' }, scoreBox(k, t, v.before, null), arrow(k, v.move), scoreBox(k, t, v.score, lit)),
    k.box({ marginTop: 26 }, episodeLine(k, t, v)),
  ]
  return card(k, t, v.art.hero, head, 440, v.cta)
}

export default { key: 'rating-move', name: 'Episode rating on the move', urgent: true, gapDays: 300, titleGap: false, window: 1, find, captions, questions, tags: (p) => p.tags, template, extra: ratingsExtra }
