/**
 * Reel "Airing today": today's new episodes of anime made from comics, one
 * show per slide in order of air time. On Instagram the same day goes as a
 * swipe post of the "Episodes out today" post (today.mjs).
 *
 * Data: today's rows of the airing schedule that the airing posts take
 * (out-now.mjs: popular enough, an official stream), the most followed
 * MAX_ITEMS of them. It needs MIN_ITEMS, and is made once a day. Off until
 * its name is written in FB_POST_TYPES.
 */
import { BIO_END_LINE, CAROUSEL_FRAME, END_LINE, endSlide, hookSlide, itemSlide, titleSlide } from '../reel/slides.mjs'
import { tagOf, uniqueTags } from '../story.mjs'
import { clip, listOf } from '../text.mjs'
import { dateOf, dayMonthOf, timeOf, weekdayOf } from '../when.mjs'
import { airingRows, linkOf } from './out-now.mjs'
import { ctaOf, top } from './shared.mjs'

export const MIN_ITEMS = 3
export const MAX_ITEMS = 6

const itemOf = ({ row, title }) => ({ time: timeOf(row.at * 1000), title: clip(title.title, 60), note: [`Episode ${row.episode}`, top(title.platforms.filter((name) => !/amazon/i.test(name)), 1)[0]].filter(Boolean).join(' · ') })

/** The post for these episodes (most followed first), shown in order of air time. */
function toPost(all, now) {
  const shown = all.slice(0, MAX_ITEMS).sort((x, y) => x.row.at - y.row.at)
  const lead = all[0].title
  const link = linkOf(lead)
  return {
    item: `today:${dateOf(now)}`,
    // Names no single title: each show still gets its own posts the same day.
    title: null,
    path: link.path,
    label: link.noun ? `${lead.title}: ${link.label.toLowerCase()}` : `${lead.title}: where to watch it`,
    names: all.slice(0, 3).map(({ title }) => title.title),
    total: all.length,
    tags: uniqueTags([...all.slice(0, 3).map(({ title }) => tagOf(title.title)), '#NewEpisode', '#anime', '#manga']),
    art: { thumbs: shown.map(({ title }) => title.image) },
    view: { date: `${weekdayOf(now)} ${dayMonthOf(now)}`, items: shown.map(itemOf) },
    without: (blank) => {
      const drop = new Set(blank.map((i) => shown[i]))
      const rest = all.filter((x) => !drop.has(x))
      return rest.length >= MIN_ITEMS ? toPost(rest, now) : null
    },
  }
}

export function find(data, { now }) {
  const today = dateOf(now)
  const rows = airingRows(data, (row) => dateOf(row.at * 1000) === today)
  return rows.length >= MIN_ITEMS ? [toPost(rows, now)] : []
}

const captions = [
  (p) => ({ hook: `📺 ${p.total} anime from manga and manhwa air a new episode today, ${p.view.date}.`, facts: [`Among them: ${listOf(p.names)}.`, 'All times are US Eastern.'], cta: ctaOf('first', 0) }),
  (p) => ({ hook: `⏰ Today's new episodes, in order of air time.`, facts: [`${listOf(p.names)} lead the day.`, 'All times are US Eastern.'], cta: ctaOf('first', 1) }),
  (p) => ({ hook: `🚨 New episode day 🚨 ${listOf(p.names)}.`, facts: [`${p.total} shows in all, ${p.view.date}.`], cta: ctaOf('first', 2) }),
]

const questions = [() => 'Which one are you watching first?', (p) => `Are you keeping up with ${p.names[0]}?`, () => 'Which of these is your pick of the day?']

function slides(v, k) {
  return [
    titleSlide(k, { kicker: v.date, lines: [{ text: 'AIRING' }, { text: 'TODAY', pop: true }], sub: 'New episodes, in order of air time. Times are US Eastern.' }),
    ...v.items.map((row, i) => itemSlide(k, { tag: row.time, tagNote: 'ET', picture: v.art.thumbs[i], title: row.title, note: row.note, step: `${i + 1} / ${v.items.length}` })),
    endSlide(k, { head: 'Read the manga and manhwa behind them', line: END_LINE }),
  ]
}

/** The same day as an Instagram swipe post of the "Episodes out today" post (today.mjs). */
function carousel(v, k) {
  const f = CAROUSEL_FRAME
  return [
    hookSlide(k, { kicker: v.date, lines: [{ text: 'EPISODES' }, { text: 'OUT TODAY', pop: true }], sub: `${v.items.length} new episodes, in order of air time.`, pictures: v.art.thumbs.slice(0, 3) }, f),
    ...v.items.map((row, i) => itemSlide(k, { tag: row.time, tagNote: 'ET', picture: v.art.thumbs[i], title: row.title, note: row.note, step: `${i + 1} / ${v.items.length}` }, f)),
    endSlide(k, { head: 'Save this list. Follow for more.', line: BIO_END_LINE }, f),
  ]
}

export default { key: 'reel-today', carouselOf: 'today', fromPost: (post) => post, carousel, name: 'Reel: airing today', reel: true, urgent: false, gapDays: 300, titleGap: false, window: 1, find, captions, questions, tags: (p) => p.tags, slides }
