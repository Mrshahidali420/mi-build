/**
 * Reel "Top 5": a ranking of the "Ranking" post (ranking.mjs) as a
 * countdown, five to one, one cover per slide.
 *
 * Data, wording and hashtags are that post's own, and so is where the first
 * comment leads: the genre page for a genre ranking, the title in first
 * place for the ongoing one. Off until its name is written in FB_POST_TYPES.
 */
import { BIO_END_LINE, CAROUSEL_FRAME, END_LINE, endSlide, hookSlide, itemSlide, titleSlide } from '../reel/slides.mjs'
import ranking from './ranking.mjs'

/** The same post, told from five to one: the pictures follow the items. */
const toReel = (post) => ({
  ...post,
  art: { thumbs: [...post.art.thumbs].reverse() },
  view: { heading: post.view.heading, leads: post.leads, items: [...post.view.rows].reverse() },
})

const find = (data, ctx) => ranking.find(data, ctx).map(toReel)

/** "slice of life manhwa" as the lines of the opening slide: the genre, then the kind. */
function headLines(heading) {
  const words = heading.toUpperCase().split(' ')
  return [{ text: words.slice(0, -1).join(' ') }, { text: words.at(-1) }]
}

function slides(v, k) {
  return [
    titleSlide(k, { kicker: 'Ranked by readers on AniList', lines: [{ text: 'TOP 5', pop: true }, ...headLines(v.heading)], sub: 'Counting down from five to one.' }),
    ...v.items.map((row, i) => itemSlide(k, { tag: `#${row.rank}`, picture: v.art.thumbs[i], title: row.title, note: [row.score && `${row.score} score`, `${row.count} readers`].filter(Boolean).join(' · '), step: `${i + 1} / ${v.items.length}` })),
    endSlide(k, { head: v.leads === 'list' ? `More ${v.heading}` : 'Where to read number one', line: END_LINE }),
  ]
}

/** The same countdown as an Instagram swipe post: the hook shows the lower ranks, never number one. */
function carousel(v, k) {
  const f = CAROUSEL_FRAME
  return [
    hookSlide(k, { kicker: 'Ranked by readers on AniList', lines: [{ text: 'TOP 5', pop: true }, ...headLines(v.heading)], sub: 'Number one is on the last slide.', pictures: v.art.thumbs.slice(0, 3) }, f),
    ...v.items.map((row, i) => itemSlide(k, { tag: `#${row.rank}`, picture: v.art.thumbs[i], title: row.title, note: [row.score && `${row.score} score`, `${row.count} readers`].filter(Boolean).join(' · '), step: `${i + 1} / ${v.items.length}` }, f)),
    endSlide(k, { head: 'Save this list. Follow for more.', line: BIO_END_LINE }, f),
  ]
}

export default { key: 'reel-ranking', carouselOf: 'ranking', fromPost: toReel, carousel, name: 'Reel: top 5', reel: true, urgent: false, gapDays: 60, titleGap: false, window: 1, find, captions: ranking.captions, questions: ranking.questions, tags: (p) => p.tags, slides }
