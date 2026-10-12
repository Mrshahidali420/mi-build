/**
 * "Character spotlight": one lead character of a popular comic or novel.
 *
 * Data: the main cast on the title's record, with the character's own
 * picture. The record holds no more about a character than the name, the
 * picture and the role, so the image says only that. One post per character,
 * at most every six months.
 *
 * Image: cream paper. The name large at the top, the portrait on a flat
 * block of the accent colour with the labelled lines beside it, a line about
 * the story and where to read it across the foot.
 */
import { clip, fitSize, isDrawable, listOf } from '../text.mjs'
import { FOOT, H, INNER, PAD, linesOf } from '../render/parts.mjs'
import { ctaOf, keyFacts, single, statusWord, top } from './shared.mjs'

export const MIN_POPULARITY = 20_000
/** At most this many characters from one title are offered. */
const PER_TITLE = 2
/** AniList portraits are 230 px wide: shown at 400 at most, so never stretched past 1.75 times. */
const PORTRAIT = { width: 400, height: 600, min: 420 }
/** Heights of the fixed pieces of the image, in pixels. */
const HEAD = 53
const GAPS = 18 + 34 + 26 + 30 + 20
/** The foot (the title's cover, where to read it, a line about the story): its least and greatest height. */
const FOOT_BLOCK = { min: 200, max: 320 }
const CTA = 'The cast and where to read it: link in the first comment'
const BLOCK_SHIFT = 26
/** Capitals of the display face are wider than its mixed case. */
const UPPER_FACE = 0.7
const NAME_STEPS = [[9, 124], [12, 100], [16, 80], [22, 62], [40, 50]]

function toPost(title, member) {
  return {
    ...single(title),
    item: `char:${member.id}`,
    label: 'Where to read it',
    name: member.name,
    facts: keyFacts(title),
    noun: title.noun,
    sites: top(title.platforms),
    art: { hero: member.image, thumbs: [title.image] },
    view: {
      name: clip(member.name, 40),
      // The labelled lines beside the portrait; one the record lacks is left out.
      lines: [['From', clip(title.title, 60)], ['What it is', title.noun], ['Genre', top(title.genres, 2).join(' · ')], ['Status', statusWord(title)], ['Score', title.rating && `${title.rating} on AniList`]].filter(([, value]) => value),
      sites: top(title.platforms).map((s) => clip(s, 16)),
      tagline: title.tagline,
    },
  }
}

const find = (data) =>
  data.titles
    .filter((t) => t.verb === 'read' && t.popularity >= MIN_POPULARITY && isDrawable(t.title))
    .flatMap((t) => t.cast.filter((m) => isDrawable(m.name)).slice(0, PER_TITLE).map((m) => toPost(t, m)))

const captions = [
  (p) => ({ hook: `✨ Character spotlight: ${p.name}, from ${p.title}.`, facts: [`You can read the ${p.noun} on ${listOf(p.sites)}.`, ...p.facts], cta: ctaOf('read', 0) }),
  (p) => ({ hook: `🎭 Meet ${p.name}, one of the leads of ${p.title}.`, facts: [`Read it on ${listOf(p.sites)}.`, ...p.facts], cta: ctaOf('read', 1) }),
  (p) => ({ hook: `👀 ${p.name} is a main character of ${p.title}.`, facts: [`The ${p.noun} is on ${listOf(p.sites)}.`, ...p.facts], cta: ctaOf('read', 2) }),
]

const questions = [(p) => `Who is your favourite character in ${p.title}?`, (p) => `Is ${p.name} your favourite in ${p.title}?`, (p) => `Which ${p.title} character should we feature next?`]

function line([label, value], k, t, roomy) {
  return k.col({ borderTop: `2px solid ${t.line}`, paddingTop: roomy ? 14 : 10, paddingBottom: roomy ? 18 : 10 }, k.kicker(label, { color: t.soft, fontSize: roomy ? 21 : 19, letterSpacing: 3 }), k.display({ ...k.clamp(2), fontSize: (roomy ? 40 : 34) - (value.length > 22 ? 6 : 0), lineHeight: 1.08, marginTop: 4 }, value))
}

/** The room under the header for the name, the portrait and the foot. */
const roomOf = (v, nameSize) => H - PAD * 2 - FOOT - HEAD - GAPS - linesOf(v.name, nameSize, INNER, { face: UPPER_FACE }) * nameSize * 1.02

/** The portrait takes what the foot's least height leaves; the foot then takes the rest. */
const portraitHeight = (room) => Math.max(PORTRAIT.min, Math.min(PORTRAIT.height, Math.floor(room - FOOT_BLOCK.min)))

function template(v, k) {
  const t = k.tone('light')
  const nameSize = fitSize(v.name, NAME_STEPS)
  const room = roomOf(v, nameSize)
  const height = portraitHeight(room)
  const portrait = v.art.hero ? k.contain(v.art.hero.ratio, PORTRAIT.width, height) : { width: PORTRAIT.width, height }
  const side = INNER - portrait.width - BLOCK_SHIFT - 44
  const roomy = v.lines.length <= 4
  const sites = v.sites.join(' · ')
  const foot = Math.max(FOOT_BLOCK.min, Math.min(FOOT_BLOCK.max, Math.floor(room - portrait.height)))
  const cover = v.art.thumbs?.[0] ? k.contain(v.art.thumbs[0].ratio, foot, foot) : null
  const beside = INNER - (cover ? cover.width + 30 : 0)
  return k.page(
    t,
    { cta: CTA },
    k.kicker('Character spotlight', { color: t.soft }),
    k.rule(t.line, 2, { marginTop: 20 }),
    k.display({ ...k.clamp(2), fontSize: nameSize, fontWeight: k.f.displayBlack, lineHeight: 1.02, marginTop: 18, marginLeft: -4, textTransform: 'uppercase' }, v.name),
    k.row(
      { marginTop: 34 },
      k.box(
        { position: 'relative', width: portrait.width + BLOCK_SHIFT, height: portrait.height + BLOCK_SHIFT, flexShrink: 0 },
        k.box({ position: 'absolute', left: BLOCK_SHIFT, top: BLOCK_SHIFT, width: portrait.width, height: portrait.height, backgroundColor: t.block }),
        k.art(v.art.hero, PORTRAIT.width, height, { position: 'absolute', left: 0, top: 0 }),
      ),
      // The lines are spread over the portrait's height, so nothing is left empty beside it.
      k.col({ marginLeft: 44, width: side, height: portrait.height + BLOCK_SHIFT, justifyContent: 'space-between' }, v.lines.map((row) => line(row, k, t, roomy))),
    ),
    // The foot: the title's own cover, where to read it, and a line about the story.
    k.row(
      { marginTop: 30, height: foot, alignItems: 'center' },
      cover && k.art(v.art.thumbs[0], cover.width, cover.height, { marginRight: 30 }),
      k.col(
        { width: beside },
        v.sites.length > 0 && k.kicker('Read it on', { color: t.soft, fontSize: 21, letterSpacing: 3 }),
        v.sites.length > 0 && k.display({ ...k.clamp(2), fontSize: sites.length > 24 ? 34 : 46, marginTop: 8, lineHeight: 1.1 }, sites),
        k.tagline(v.tagline, t, { marginTop: 14, width: beside }),
      ),
    ),
    k.fill(),
  )
}

export default { key: 'character', name: 'Character spotlight', urgent: false, gapDays: 180, titleGap: false, window: 80, find, captions, questions, tags: (p) => p.tags, template }
