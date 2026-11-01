/**
 * "Final episode": the last episode of an anime made from a comic airs
 * today. Airing news: urgent, and its own post even when the title had
 * another post today (`sameDay`, plan.mjs).
 *
 * Data: an airing schedule row of today whose episode is the show's last
 * (the record's episode count, more than one), popular enough, with a
 * stream. The link: the comic it is made from when the index has it, for
 * the story after the anime ends.
 *
 * Image: the "Out now" card (out-now.mjs) with the words of a finale.
 */
import { dateOf } from '../when.mjs'
import { airingPost, airingRows, ctaFor, heroCard } from './out-now.mjs'

function find(data, { now }) {
  const today = dateOf(now)
  return airingRows(data, (row) => dateOf(row.at * 1000) === today)
    .filter(({ row, title }) => title.episodes > 1 && row.episode === title.episodes)
    .map(({ row, title }) => ({ ...airingPost(title, row, { mark: 'final' }), aired: row.at * 1000 <= now }))
}

const loud = (p) => p.title.toUpperCase()
const when = (p) => (p.aired ? 'AIRED' : 'AIRS')
/** After the finale, the comic is where the story goes on. */
const after = (p) => (p.noun ? `The story goes on in the ${p.noun}.` : null)

const captions = [
  (p) => ({ hook: `🔥 THE FINAL EPISODE OF ${loud(p)} ${when(p)} TODAY!`, facts: [p.fact, after(p)].filter(Boolean), cta: ctaFor(p, 0) }),
  (p) => ({ hook: `🚨 ${loud(p)} ENDS TODAY WITH EPISODE ${p.episode}!`, facts: [p.fact, after(p)].filter(Boolean), cta: ctaFor(p, 1) }),
  (p) => ({ hook: `📺 IT IS FINALE DAY FOR ${loud(p)}!`, facts: [`Episode ${p.episode} is the last one.`, after(p)].filter(Boolean), cta: ctaFor(p, 2) }),
]

const questions = [(p) => `💬 How do you want ${p.title} to end?`, (p) => (p.noun ? `💬 Will you read on in the ${p.noun}?` : '💬 Will you miss this one?'), (p) => `💬 Was ${p.title} worth watching to the end?`]

const template = (v, k) => heroCard(v, k, ['FINAL EPISODE', 'TODAY'])

export default { key: 'finale', name: 'Final episode today', urgent: true, sameDay: true, gapDays: 300, titleGap: false, window: 1, find, captions, questions, tags: (p) => p.tags, template }
