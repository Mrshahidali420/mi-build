/**
 * "Episode rating": an episode of a show airing now that IMDb's viewers
 * rate high, once it has enough votes. One post per episode.
 *
 * Data: the day's IMDb snapshot (ratings/load.mjs): episodes with at least
 * MIN_VOTES votes and a score of MIN_SCORE or more, aired in the last two
 * weeks, best first.
 *
 * Image (the owner's reference: the Page ALL ANIME AT ONCE): "RATING IMDB"
 * small at the top, the score giant with a small "/10", the title with
 * "EPISODE 5" in IMDb yellow, then the picture to the foot: the episode's
 * cover whole on the dark (Manhwa Index loads no episode stills). The link is
 * the comic the anime is made from, when the index has its page (out-now.mjs).
 * The rating-move and rating-week cards are built from the same parts.
 */
import { clip } from '../text.mjs'
import { H, INNER, PAD, W } from '../render/parts.mjs'
import { MIN_SCORE, MIN_VOTES, ratingsExtra } from '../ratings/load.mjs'
import { single, usable } from './shared.mjs'
import { ctaFor, linkOf } from './out-now.mjs'

/** IMDb's own yellow, and the arrows' colours. */
export const IMDB_YELLOW = '#F5C518'
export const UP = '#2EE06A'
export const DOWN = '#FF3B3B'
/** An episode is news for this long after it aired. */
export const NEWS_MS = 14 * 86_400_000
/** The picture runs from here to the foot. */
const ART_TOP = 420
export const FOOT_HEIGHT = 190
const LINE_MAX = 40
const CTA = 'Where to watch: link in the first comment'

export const scoreText = (score) => Number(score).toFixed(1)
export const votesText = (votes) => Number(votes).toLocaleString('en-US')

/** The season a title names ("Season 2", "2nd Season", "Part 2"), or null. */
export function seasonOf(name) {
  const m = /\bseason\s*(\d+)\b/i.exec(name) || /\b(\d+)(?:st|nd|rd|th)\s+season\b/i.exec(name) || /\bpart\s*(\d+)\b/i.exec(name)
  return m ? Number(m[1]) : null
}

/** "S2.EP5", or "EP5" when the title names no season. */
export const shortEpisode = (name, ep) => (seasonOf(name) ? `S${seasonOf(name)}.EP${ep}` : `EP${ep}`)

/** The title without its season words, for the spaced line of a strip. */
export const baseName = (name) => name.replace(/[:\s-]*(\bseason\s*\d+\b|\b\d+(?:st|nd|rd|th)\s+season\b|\bpart\s*\d+\b).*$/i, '').trim() || name

/** The picture of one episode: the cover (Manhwa Index loads no episode stills). */
export const artOf = (data, title) => ({ hero: title.image })

/** The rows of the day's snapshot joined to their titles: aired in the last NEWS_MS, the title on the site. */
export function ratedEpisodes(data, now) {
  return (data.ratings?.rows || [])
    .map((row) => ({ ...row, title: data.byId?.get(row.titleId) }))
    .filter((row) => row.title && row.title.section === 'anime' && usable(row.title) && (!row.aired || row.aired > now - NEWS_MS))
}

/** The post fields every rating card shares. */
export function ratingPost(data, row, extra = {}) {
  const title = row.title
  const link = linkOf(title)
  return {
    ...single(title),
    path: link.path,
    noun: link.noun,
    synopsis: null,
    tags: single(title).tags.filter((tag) => !/amazon/i.test(tag)).slice(0, 3),
    label: link.label,
    episode: row.ep,
    score: scoreText(row.score),
    votes: row.votes,
    art: artOf(data, title, row.ep),
    view: { line: clip(title.title.toUpperCase(), LINE_MAX), episode: row.ep, score: scoreText(row.score), cta: link.noun ? `Read the ${link.noun}: link in the first comment` : CTA },
    ...extra,
  }
}

function find(data, { now }) {
  return ratedEpisodes(data, now)
    .filter((row) => row.votes >= MIN_VOTES && row.score >= MIN_SCORE)
    .sort((x, y) => y.score - x.score || y.votes - x.votes)
    .map((row) => ratingPost(data, row, { item: row.id }))
}

const loud = (p) => p.title.toUpperCase()

const captions = [
  (p) => ({ hook: `🔥 ${loud(p)} EPISODE ${p.episode} EARNS ${p.score}/10 ON IMDb!`, facts: [`Rated by ${votesText(p.votes)} viewers so far.`], cta: ctaFor(p, 0) }),
  (p) => ({ hook: `⭐ EPISODE ${p.episode} OF ${loud(p)} SCORES ${p.score}/10 ON IMDb!`, facts: [`${votesText(p.votes)} votes and counting.`], cta: ctaFor(p, 1) }),
  (p) => ({ hook: `📈 ${loud(p)} EPISODE ${p.episode} IS RATED ${p.score}/10 ON IMDb!`, facts: [`From ${votesText(p.votes)} votes.`], cta: ctaFor(p, 2) }),
]

const questions = [(p) => `💬 Did episode ${p.episode} deserve it?`, (p) => `💬 Did episode ${p.episode} deserve a ${p.score}?`, (p) => `💬 Is this the best episode of ${p.title} so far?`]

/** A picture cut to fill the box; a tall cover is cut nearer its top, where the faces are. */
export const img = (picture, width, height) => ({ type: 'img', props: { src: picture.src, width, height, style: { objectFit: 'cover', objectPosition: picture.ratio < 1 && width / height > 1 ? '50% 22%' : '50% 50%', flexShrink: 0 } } })

/** "RATING IMDB", with IMDB in yellow. */
export const ratingLabel = (k, t, size = 40) =>
  k.row({ alignItems: 'baseline', justifyContent: 'center' }, k.display({ fontSize: size, color: t.ink, letterSpacing: 2 }, 'RATING'), k.display({ fontSize: size, fontWeight: k.f.displayBlack, color: IMDB_YELLOW, marginLeft: 12 }, 'IMDB'))

/** "TITLE EPISODE 5", the episode in yellow, on one line: a long title is set smaller. */
export function episodeLine(k, t, v) {
  const size = Math.min(40, Math.floor(INNER / ((v.line.length + 10) * 0.72)))
  return k.row(
    { justifyContent: 'center', alignItems: 'baseline', maxWidth: INNER },
    k.display({ fontSize: size, color: t.ink, letterSpacing: 1, whiteSpace: 'nowrap' }, v.line),
    k.display({ fontSize: size, fontWeight: k.f.displayBlack, color: IMDB_YELLOW, marginLeft: 14, whiteSpace: 'nowrap' }, `EPISODE ${v.episode}`),
  )
}

/** A score with its small "/10". */
export const scoreMark = (k, color, score, size) =>
  k.row({ alignItems: 'flex-end' }, k.display({ fontSize: size, fontWeight: k.f.displayBlack, color, lineHeight: 0.9, letterSpacing: -4 }, score), k.display({ fontSize: Math.round(size * 0.28), fontWeight: k.f.displayBlack, color, marginLeft: 8, marginBottom: Math.round(size * 0.06) }, '/10'))

/**
 * The picture from `top` to the foot, fading into the dark above and below:
 * a wide still edge to edge; a cover large in the middle over a dimmed copy
 * of itself that fills the width.
 */
export function artPanel(picture, k, t, top) {
  const height = H - top - FOOT_HEIGHT + 60
  const inner =
    picture && picture.ratio >= 1.2
      ? img(picture, W, height)
      : k.box(
          { width: W, height, alignItems: 'center', justifyContent: 'center', position: 'relative' },
          picture ? k.box({ position: 'absolute', top: 0, left: 0, width: W, height, opacity: 0.28 }, img(picture, W, height)) : null,
          picture ? k.art(picture, W - PAD * 2, height - 30) : null,
        )
  return k.box(
    { position: 'absolute', top, left: 0, width: W, height },
    inner,
    k.box({ position: 'absolute', top: 0, left: 0, width: W, height: 200, backgroundImage: `linear-gradient(to bottom, ${t.bg}, rgba(0,0,0,0))` }),
    k.box({ position: 'absolute', bottom: 0, left: 0, width: W, height: 160, backgroundImage: `linear-gradient(to top, ${t.bg}, rgba(0,0,0,0))` }),
  )
}

/** The foot of every rating card: the line about the first comment and the brand. */
export const foot = (k, t, cta = CTA) => k.col({ position: 'absolute', left: PAD, bottom: 0, width: INNER, height: FOOT_HEIGHT, justifyContent: 'flex-end', paddingBottom: PAD - 24 }, k.cta(cta, t), k.brand(t))

/** A full card: the picture behind, the head on top, the foot. */
export const card = (k, t, picture, head, artTop = ART_TOP, cta = CTA) =>
  k.box({ width: W, height: H, backgroundColor: t.bg, color: t.ink, fontFamily: k.f.text, flexDirection: 'column', position: 'relative' }, artPanel(picture, k, t, artTop), k.col({ position: 'absolute', top: 54, left: PAD, width: INNER, alignItems: 'center' }, head), foot(k, t, cta))

function template(v, k) {
  const t = k.tone('dark')
  return card(k, t, v.art.hero, [ratingLabel(k, t), k.box({ marginTop: 6 }, scoreMark(k, t.ink, v.score, 250)), k.box({ marginTop: 18 }, episodeLine(k, t, v))], undefined, v.cta)
}

export default { key: 'rating', name: 'Episode rating on IMDb', urgent: true, gapDays: 300, titleGap: false, window: 1, find, captions, questions, tags: (p) => p.tags, template, extra: ratingsExtra }
