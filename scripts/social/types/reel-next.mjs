/**
 * Reel "If you liked X, read these": the three picks of the "What to read
 * next" post (next.mjs), one cover per slide.
 *
 * Data, wording and hashtags are that post's own; a pick whose cover is a
 * blank placeholder gives way to the next one the same way. Off until its
 * name is written in FB_POST_TYPES.
 */
import { END_LINE, endSlide, itemSlide, titleSlide } from '../reel/slides.mjs'
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

export default { key: 'reel-next', name: 'Reel: if you liked X, read these', reel: true, urgent: false, gapDays: 60, titleGap: true, window: 200, find, captions: next.captions, questions: next.questions, tags: (p) => p.tags, slides }
