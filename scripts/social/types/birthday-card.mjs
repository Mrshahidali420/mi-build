/**
 * "Happy birthday": a character whose birthday is today.
 *
 * Data: today's birthdays from AniList (birthdays.mjs), kept only when one
 * of the works the character appears in has a live page on this site, so
 * the link in the first comment leads somewhere. A handful a day at most,
 * the most-favourited first, each character once a year. The list is used
 * only on the day it was made for.
 *
 * Image: the two words very large, a few flat paper shapes beside them, the
 * portrait on a flat block of the accent colour with the day as a big
 * number beside it, the name in a solid band, then the series and the date.
 *
 * birthdayType() makes the type for one site: `verb` says which works count
 * ('watch' for an anime site, 'read' for a comics site).
 */
import { birthdayLabel } from '../birthdays.mjs'
import { baseTitle, tagOf, uniqueTags } from '../story.mjs'
import { clip, fitSize, isDrawable, listOf } from '../text.mjs'
import { dateOf, partsOf } from '../when.mjs'
import { INNER } from '../render/parts.mjs'
import { ctaOf, single, top } from './shared.mjs'

/** A year, less a few weeks: the same character never twice for one birthday, and never missed the year after. */
export const GAP_DAYS = 330
/** AniList portraits are 230 px wide: shown at 400 at most, so never stretched past 1.75 times. */
const PORTRAIT = { width: 400, height: 580 }
const BLOCK_SHIFT = 24
/** Capitals of the display face, as a share of the size (on the wide side, so the widest word fits). */
const CAPS_FACE = 0.84
const WORDS = ['HAPPY', 'BIRTHDAY']
const HEAD_MAX = 150
const NAME_STEPS = [[10, 74], [14, 62], [18, 50], [24, 40], [40, 32]]
/** Flat paper shapes beside the first word: [left, top, width, height, turn, colour]. */
const CONFETTI = [[60, 18, 26, 26, 12, 'pop'], [110, 70, 40, 14, -20, 'ink'], [180, 6, 16, 16, 30, 'ink'], [230, 84, 22, 22, 45, 'pop'], [150, 104, 14, 40, 18, 'pop'], [262, 20, 44, 12, -12, 'pop'], [72, 112, 18, 18, 0, 'ink']]

const LABEL = { watch: 'Cast, voice actors and where to watch', read: 'Where to read it' }
const CTA = { watch: 'The cast and where to watch: link in the first comment', read: 'Where to read it: link in the first comment' }

/** The work of a character that has a page here: the first of theirs this site promotes for `verb`. */
export const chooser = (data, verb) => (character) => {
  for (const work of character.media || []) {
    const title = data.byId?.get(work.id)
    if (title && title.verb === verb && isDrawable(title.title)) return { mediaId: work.id, voice: work.voice }
  }
  return null
}

function toPost(title, person, now, verb) {
  const date = birthdayLabel(now)
  const sites = top(title.platforms)
  return {
    ...single(title),
    // A birthday post is about the character: the story's synopsis stays out of it, and so does the
    // rule of one post per title a day (plan.mjs reads `title`), or an episode card would cancel a birthday.
    synopsis: null,
    title: null,
    series: title.title,
    item: `bday:${person.id}`,
    label: LABEL[verb],
    name: person.name,
    verb,
    voice: person.voice,
    sites,
    tags: uniqueTags([tagOf(person.name), tagOf(baseTitle(title.title)) || tagOf(title.title), '#HappyBirthday', tagOf(title.section, { lower: true }), tagOf(sites[0])]),
    art: { hero: person.image },
    view: {
      verb,
      name: clip(person.name, 60),
      from: clip(title.title, 64),
      month: date.split(' ')[0],
      day: String(partsOf(now).day),
      date,
      lines: [['From', clip(title.title, 64)], verb === 'watch' && person.voice && ['Japanese voice', clip(person.voice, 30)], sites.length > 0 && [verb === 'watch' ? 'Watch it on' : 'Read it on', sites.map((s) => clip(s, 16)).join(' · ')]].filter(Boolean),
    },
  }
}

const findFor = (verb) => (data, { now }) => {
  const today = data.birthdays
  if (!today || today.day !== dateOf(now)) return []
  return (today.list || [])
    .map((person) => ({ person, title: data.byId.get(person.mediaId) }))
    .filter(({ person, title }) => title && title.verb === verb && isDrawable(person.name))
    .map(({ person, title }) => toPost(title, person, now, verb))
}

const who = (p) => (p.verb === 'watch' && p.voice ? `${p.name} is a character in ${p.series}, voiced by ${p.voice} in Japanese.` : `${p.name} is a character in ${p.series}.`)
const where = (p) => (p.sites.length ? `${p.verb === 'watch' ? 'You can watch it on' : 'You can read it on'} ${listOf(p.sites)}.` : null)

const captions = [
  (p) => ({ hook: `🎉 Happy birthday, ${p.name}!`, facts: [who(p), where(p)], cta: ctaOf(p.verb, 0) }),
  (p) => ({ hook: `🎂 Today is ${p.name}'s birthday 🎉`, facts: [who(p), where(p)], cta: ctaOf(p.verb, 1) }),
  (p) => ({ hook: `🎉 ${p.view.date}: happy birthday to ${p.name}!`, facts: [who(p), where(p)], cta: ctaOf(p.verb, 2) }),
]

const questions = [(p) => `What is your favourite ${p.name} moment?`, (p) => `Is ${p.name} one of your favourites in ${p.series}?`, (p) => `What do you like most about ${p.name}?`]

function line([label, value], k, t) {
  return k.col({ borderTop: `2px solid ${t.line}`, paddingTop: 10, paddingBottom: 12 }, k.kicker(label, { color: t.soft, fontSize: 19, letterSpacing: 3 }), k.display({ ...k.clamp(3), fontSize: value.length > 26 ? 26 : 32, lineHeight: 1.12, marginTop: 4 }, value))
}

function confetti(k, t) {
  return k.box({ position: 'relative', width: 310, height: 150 }, CONFETTI.map(([left, top_, width, height, turn, colour]) => k.box({ position: 'absolute', left, top: top_, width, height, backgroundColor: colour === 'pop' ? t.pop : t.ink, transform: `rotate(${turn}deg)` })))
}

function template(v, k) {
  const t = k.tone('dark')
  const head = Math.min(HEAD_MAX, Math.floor(INNER / (WORDS[1].length * CAPS_FACE)))
  const portrait = v.art.hero ? k.contain(v.art.hero.ratio, PORTRAIT.width, PORTRAIT.height) : PORTRAIT
  const side = INNER - portrait.width - BLOCK_SHIFT - 40
  const word = (value, style = {}) => k.display({ fontSize: head, fontWeight: k.f.displayBlack, lineHeight: 0.98, marginLeft: -5, whiteSpace: 'nowrap', ...style }, value)
  return k.page(
    t,
    { cta: CTA[v.verb] },
    k.row({ justifyContent: 'space-between', alignItems: 'flex-start' }, word(WORDS[0], { color: t.pop }), confetti(k, t)),
    word(WORDS[1]),
    k.row(
      { marginTop: 30 },
      k.box(
        { position: 'relative', width: portrait.width + BLOCK_SHIFT, height: portrait.height + BLOCK_SHIFT, flexShrink: 0 },
        k.box({ position: 'absolute', left: BLOCK_SHIFT, top: BLOCK_SHIFT, width: portrait.width, height: portrait.height, backgroundColor: t.block }),
        k.art(v.art.hero, PORTRAIT.width, PORTRAIT.height, { position: 'absolute', left: 0, top: 0 }),
      ),
      k.col(
        { marginLeft: 40, width: side, height: portrait.height + BLOCK_SHIFT, justifyContent: 'space-between' },
        k.col({}, k.display({ fontSize: v.day.length > 1 ? 240 : 280, fontWeight: k.f.displayBlack, color: t.pop, lineHeight: 0.9, marginLeft: -6 }, v.day), k.kicker(v.month, { color: t.ink, fontSize: 30, letterSpacing: 8, marginTop: 8 })),
        k.col({}, v.lines.map((row) => line(row, k, t))),
      ),
    ),
    // The name in a solid band: a flat block, the page colour for the letters.
    k.box(
      { marginTop: 22, backgroundColor: t.block, paddingLeft: 26, paddingRight: 26, paddingTop: 16, paddingBottom: 16 },
      k.display({ ...k.clamp(2), fontSize: fitSize(v.name, NAME_STEPS), fontWeight: k.f.displayBlack, lineHeight: 1.04, color: t.bg, textTransform: 'uppercase' }, v.name),
    ),
    k.fill(),
  )
}

/** The birthday type of one site. `birthdays(data)` is how a run learns which characters to keep (post.mjs). */
export const birthdayType = ({ verb }) => ({ key: 'birthday', name: 'Character birthday', urgent: false, gapDays: GAP_DAYS, titleGap: false, window: 1, find: findFor(verb), captions, questions, tags: (p) => p.tags, template, birthdays: (data) => chooser(data, verb) })
