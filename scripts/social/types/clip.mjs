/**
 * Clips of the trending episode, made by the recap project (clip/store.mjs).
 *
 * Two kinds from one clip:
 *   clip-reel   the short (60 s at most): a Facebook Reel, and an Instagram Reel when Instagram is on
 *   clip-video  the whole clip (1 to 4 minutes): a normal Facebook video post
 * Each carries the Page's logo (put on by the recap project). The first comment links the title page.
 * Off until the name is written in FB_POST_TYPES. The owner accepts the Rights Manager risk (1 Nov 2026).
 */
import { tagOf, uniqueTags } from '../story.mjs'
import { downloadClip } from '../clip/store.mjs'
import { single, usable } from './shared.mjs'

const SHORT_MAX_SECONDS = 90
const CTAS = ['👇 Where to watch it: the link is in the first comment.', '👇 Watch the whole episode legally: the link is in the first comment.']

function posts(data, which) {
  return (data.clips?.items || [])
    .map((it) => ({ it, title: data.byId?.get(it.anilist_id) }))
    .filter(({ it, title }) => title && usable(title) && (which === 'full' ? Boolean(it.full_id) : Boolean(it.short_id) && it.short_seconds <= SHORT_MAX_SECONDS))
    .map(({ it, title }) => ({
      ...single(title),
      item: `${it.id}:${which}`,
      title: title.title,
      at: it.made_at * 1000,
      label: 'Where to watch it',
      names: [title.title],
      clip: { item: it, which, line: it.title, question: it.comment, seconds: which === 'full' ? it.full_seconds : it.short_seconds },
      tags: uniqueTags([tagOf(title.title), '#anime', '#animeclips']),
    }))
}

const captions = [
  (p) => ({ hook: `🎬 ${p.clip.line}`, facts: [], cta: CTAS[0] }),
  (p) => ({ hook: `🔥 ${p.clip.line}`, facts: [], cta: CTAS[1] }),
]
const questions = [(p) => p.clip.question || `Did you watch ${p.title} this week?`]

/** The file, ready to send. The same shape a reel from slides gives: { mp4, seconds }. */
const render = (which) => async (type, post, { env = process.env, fetch = globalThis.fetch } = {}) => ({
  mp4: await downloadClip(post.clip.item, which, { env, fetch }),
  seconds: post.clip.seconds,
  track: null,
})

const common = { urgent: true, gapDays: 30, titleGap: false, sameDay: true, window: 1, captions, questions, tags: (p) => p.tags }

export const clipReel = { ...common, key: 'clip-reel', name: 'Reel: clip of a trending episode', reel: true, find: (data) => posts(data, 'short'), render: render('short') }
export const clipVideo = { ...common, key: 'clip-video', name: 'Video: clip of a trending episode', video: true, find: (data) => posts(data, 'full'), render: render('full') }
export default clipReel
