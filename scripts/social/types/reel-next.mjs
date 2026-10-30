/**
 * Reel "If you liked X, read these": the three picks of the "What to read
 * next" post (next.mjs), one cover per slide.
 *
 * Data, wording and hashtags are that post's own; a pick whose cover is a
 * blank placeholder gives way to the next one the same way. Off until its
 * name is written in FB_POST_TYPES.
 */
import { BIO_END_LINE, CAROUSEL_FRAME, END_LINE, endSlide, hookSlide, itemSlide, titleSlide } from '../reel/slides.mjs'
import next from './next.mjs'

const toReel = (post) => ({
  ...post,
  view: { title: post.view.title, items: post.view.recs },
  without: (blank) => {
    const rest = post.without(blank)
    return rest ? toReel(rest) : null
  },
})

const find = (data, ctx) => next.find(data, ctx).map(toReel)

function slides(v, k) {
  return [
    titleSlide(k, { kicker: 'If you liked', lines: [{ text: 'READ' }, { text: 'NEXT', pop: true }], sub: `Three picks from AniList readers for fans of ${v.title}.`, picture: v.art.hero }),
    ...v.items.map((rec, i) => itemSlide(k, { tag: String(i + 1), picture: v.art.thumbs[i], title: rec.title, note: rec.rating ? `${rec.rating} on AniList` : null, step: `${i + 1} / ${v.items.length}` })),
    endSlide(k, { head: 'Where to read it, and more like it', line: END_LINE }),
  ]
}

/** The longest title the hook's top line names; a longer one is named in the line under READ NEXT only. */
const HOOK_TITLE_MAX = 26

/** The same picks as an Instagram swipe post: the hook shows the covers, the names come one swipe later. */
function carousel(v, k) {
  const f = CAROUSEL_FRAME
  return [
    hookSlide(k, { kicker: v.title.length <= HOOK_TITLE_MAX ? `If you liked ${v.title}` : 'If you liked', lines: [{ text: 'READ' }, { text: 'NEXT', pop: true }], sub: `${v.items.length} picks from AniList readers for fans of ${v.title}.`, pictures: v.art.thumbs }, f),
    ...v.items.map((rec, i) => itemSlide(k, { tag: String(i + 1), picture: v.art.thumbs[i], title: rec.title, note: rec.rating ? `${rec.rating} on AniList` : null, step: `${i + 1} / ${v.items.length}` }, f)),
    endSlide(k, { head: 'Save this list. Follow for more.', line: BIO_END_LINE }, f),
  ]
}

export default { key: 'reel-next', carouselOf: 'next', fromPost: toReel, carousel, name: 'Reel: if you liked X, read these', reel: true, urgent: false, gapDays: 60, titleGap: true, window: 200, find, captions: next.captions, questions: next.questions, tags: (p) => p.tags, slides }
