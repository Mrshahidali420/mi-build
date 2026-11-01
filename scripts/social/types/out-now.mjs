/**
 * "Out now": an episode of an anime made from a manga, manhwa or manhua has
 * just aired. Airing news (the same queue as WhereAnime's, where-build
 * tasks/airing-queue-plan.md): it goes before the rotation, in the four
 * hours after the air time, and is its own post even when the title had
 * another post today (`sameDay`, plan.mjs).
 *
 * Data: the airing schedule rows (data/airing.json) whose time is between
 * AFTER_MS ago and now, joined to the anime: popular enough, with an
 * official stream.
 *
 * The link: the comic the anime is made from, when the index has its page
 * ("Read the manga it is based on"); else the anime's own page.
 *
 * Image: the cover whole across the top on the dark, the headline large
 * under it and one solid tag, title then episode (the look of the news
 * Pages the owner pointed to). The caption is short: a capitals hook, one
 * fact, a question, the link line, three hashtags.
 */
import { clip } from '../text.mjs'
import { dayMonthOf, timeOf, weekdayOf } from '../when.mjs'
import { H, INNER, PAD, W } from '../render/parts.mjs'
import { byPopularity, ctaOf, single, top, uniqueBy, usable } from './shared.mjs'

export const MIN_POPULARITY = 2000
/** How long after its air time an episode is still news. */
export const AFTER_MS = 4 * 3_600_000
const HERO = { height: 790 }
const TAG_TITLE_MAX = 30
/** The tag's type size: a long title is set smaller so it is not cut. */
const tagSize = (title) => (title.length > 22 ? 24 : title.length > 16 ? 28 : 32)

/** Where the first comment leads, and the words for it. */
export function linkOf(title) {
  const comic = title.sourceComic
  if (comic) return { path: comic.path, label: `Read the ${comic.noun} it is based on`, noun: comic.noun }
  return { path: title.path, label: 'Where to watch it', noun: null }
}

/** The caption's link line: the comic when there is one, else where to watch. */
export const ctaFor = (p, turn) => (p.noun ? `👇 Read the ${p.noun} ${p.title} is based on: link in the first comment.` : ctaOf('watch', turn))

/** The post for one episode; `mark` names the news ('out', 'final'). */
export function airingPost(title, row, { mark }) {
  const at = row.at * 1000
  const link = linkOf(title)
  return {
    ...single(title),
    // Short captions: no synopsis.
    synopsis: null,
    tags: single(title).tags.filter((tag) => !/amazon/i.test(tag)).slice(0, 3),
    item: `${title.id}:${mark === 'final' ? 'final' : `${row.episode}:${mark}`}`,
    path: link.path,
    label: link.label,
    noun: link.noun,
    at,
    episode: row.episode,
    fact: factOf(title, at),
    art: { hero: title.image },
    view: {
      title: clip(title.title.toUpperCase(), TAG_TITLE_MAX),
      episode: row.episode,
      cta: link.noun ? `Read the ${link.noun}: link in the first comment` : 'Where to watch: link in the first comment',
    },
  }
}

/** The one fact under the hook: where it streams (never Amazon by name: the caption gate bans the word), else when it airs. */
function factOf(title, at) {
  const streams = top(title.platforms.filter((name) => !/amazon/i.test(name)), 2)
  return streams.length ? `It streams on ${streams.join(' and ')}.` : `It airs ${weekdayOf(at)} ${dayMonthOf(at)} at ${timeOf(at)} ET.`
}

/** The schedule rows of popular anime with a stream, most popular first, one per episode. */
export function airingRows(data, keep) {
  const rows = (data.schedule || [])
    .filter((row) => row.mediaId && row.episode > 0 && keep(row))
    .map((row) => ({ row, title: data.byId.get(row.mediaId) }))
    .filter(({ title }) => title && title.section === 'anime' && title.platforms.length && title.popularity >= MIN_POPULARITY && usable(title))
    .sort((x, y) => byPopularity(x.title, y.title))
  return uniqueBy(rows, ({ row }) => `${row.mediaId}:${row.episode}`)
}

function find(data, { now }) {
  return airingRows(data, (row) => row.at * 1000 <= now && row.at * 1000 > now - AFTER_MS).map(({ row, title }) => airingPost(title, row, { mark: 'out' }))
}

const loud = (p) => p.title.toUpperCase()

const captions = [
  (p) => ({ hook: `🔥 ${loud(p)} EPISODE ${p.episode} IS OUT NOW!`, facts: [p.fact], cta: ctaFor(p, 0) }),
  (p) => ({ hook: `🚨 EPISODE ${p.episode} OF ${loud(p)} JUST DROPPED!`, facts: [p.fact], cta: ctaFor(p, 1) }),
  (p) => ({ hook: `📺 ${loud(p)} IS BACK WITH EPISODE ${p.episode}!`, facts: [p.fact], cta: ctaFor(p, 2) }),
]

const questions = [(p) => (p.noun ? `💬 Have you read the ${p.noun} too?` : `💬 Are you watching ${p.title}?`), (p) => `💬 What did you think of episode ${p.episode}?`, (p) => `💬 Have you watched episode ${p.episode} yet?`]

/** The picture across the top: the cover whole on the dark. */
function hero(picture, k) {
  if (!picture) return k.box({ width: W, height: HERO.height, backgroundColor: k.theme.color.raised, flexShrink: 0 })
  return k.box({ width: W, height: HERO.height, backgroundColor: k.theme.color.raised, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, k.art(picture, W - PAD * 2, HERO.height - 60))
}

/**
 * The card: the picture, the headline (second line in the accent), then the tag.
 * @param headline [first line, second line]
 */
export function heroCard(v, k, headline) {
  const t = k.tone('dark')
  const size = headline.some((line) => line.length > 10) ? 96 : 116
  return k.box(
    { width: W, height: H, backgroundColor: t.bg, color: t.ink, fontFamily: k.f.text, flexDirection: 'column' },
    hero(v.art.hero, k),
    k.col(
      { width: INNER, marginLeft: PAD, flexGrow: 1, paddingTop: 30 },
      k.display({ fontSize: size, fontWeight: k.f.displayBlack, lineHeight: 0.95, whiteSpace: 'nowrap' }, headline[0]),
      k.display({ fontSize: size, fontWeight: k.f.displayBlack, lineHeight: 0.95, color: t.pop, whiteSpace: 'nowrap' }, headline[1]),
      // One solid tag: the title on the accent, the episode on the dark, the way the news Pages mark an episode.
      k.row(
        { marginTop: 24, alignSelf: 'flex-start', border: `3px solid ${t.pop}`, maxWidth: INNER },
        k.display({ ...k.clamp(1), fontSize: tagSize(v.title), fontWeight: k.f.displayBlack, color: k.theme.color.night, backgroundColor: t.pop, paddingTop: 10, paddingBottom: 8, paddingLeft: 18, paddingRight: 18, maxWidth: INNER - 250 }, v.title),
        k.display({ fontSize: tagSize(v.title), fontWeight: k.f.displayBlack, color: t.ink, paddingTop: 10, paddingBottom: 8, paddingLeft: 18, paddingRight: 18, whiteSpace: 'nowrap' }, `EPISODE ${v.episode}`),
      ),
      k.fill(),
    ),
    k.col({ width: INNER, marginLeft: PAD, paddingBottom: PAD - 24 }, k.cta(v.cta, t), k.brand(t)),
  )
}

const template = (v, k) => heroCard(v, k, [`EPISODE ${v.episode}`, 'OUT NOW'])

export default { key: 'out-now', name: 'Episode out now', urgent: true, sameDay: true, gapDays: 300, titleGap: false, window: 1, find, captions, questions, tags: (p) => p.tags, template }
