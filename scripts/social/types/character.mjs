/**
 * "Character spotlight": one lead character of a popular comic or novel.
 *
 * Data: the main cast on the title's record, with the character's own
 * picture. The record holds no more about a character than the name, the
 * picture and the role, so the image says only that. One post per character,
 * at most every six months.
 *
 * Image: cream paper. The portrait on a flat block of the accent colour, the
 * facts beside it, the name very large across the foot.
 */
import { clip, fitSize, isDrawable, listOf } from '../text.mjs'
import { INNER } from '../render/parts.mjs'
import { ctaOf, keyFacts, single, statusWord, top } from './shared.mjs'

export const MIN_POPULARITY = 20_000
/** At most this many characters from one title are offered. */
const PER_TITLE = 2
const PORTRAIT = { width: 470, height: 705 }
const CTA = 'The cast and where to read it: link in the first comment'
const BLOCK_SHIFT = 26
const NAME_STEPS = [[10, 150], [14, 120], [18, 96], [24, 78], [40, 62]]

function toPost(title, member) {
  return {
    ...single(title),
    item: `char:${member.id}`,
    label: 'Where to read it',
    name: member.name,
    facts: keyFacts(title),
    noun: title.noun,
    sites: top(title.platforms),
    art: { hero: member.image },
    view: {
      name: clip(member.name, 40),
      // The labelled lines beside the portrait; one the record lacks is left out.
      lines: [['From', clip(title.title, 60)], ['What it is', title.noun], ['Genre', top(title.genres, 2).join(' · ')], ['Status', statusWord(title)], ['Score', title.rating && `${title.rating} on AniList`], ['Read it on', top(title.platforms).map((s) => clip(s, 26)).join(', ')]].filter(([, value]) => value),
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
  return k.col({ borderTop: `2px solid ${t.line}`, paddingTop: roomy ? 14 : 10, paddingBottom: roomy ? 22 : 13 }, k.kicker(label, { color: t.soft, fontSize: roomy ? 21 : 19, letterSpacing: 3 }), k.display({ ...k.clamp(2), fontSize: (roomy ? 42 : 34) - (value.length > 22 ? 6 : 0), lineHeight: 1.08, marginTop: 4 }, value))
}

function template(v, k) {
  const t = k.tone('light')
  const portrait = v.art.hero ? k.contain(v.art.hero.ratio, PORTRAIT.width, PORTRAIT.height) : PORTRAIT
  const roomy = v.lines.length <= 4
  return k.page(
    t,
    { cta: CTA },
    k.row(
      {},
      k.box(
        { position: 'relative', width: portrait.width + BLOCK_SHIFT, height: portrait.height + BLOCK_SHIFT, flexShrink: 0 },
        k.box({ position: 'absolute', left: BLOCK_SHIFT, top: BLOCK_SHIFT, width: portrait.width, height: portrait.height, backgroundColor: t.block }),
        k.art(v.art.hero, PORTRAIT.width, PORTRAIT.height, { position: 'absolute', left: 0, top: 0 }),
      ),
      k.col(
        { marginLeft: 44, width: INNER - portrait.width - BLOCK_SHIFT - 44 },
        k.kicker('Character spotlight', { color: t.ink, marginBottom: 24 }),
        v.lines.map((row) => line(row, k, t, roomy)),
      ),
    ),
    k.display({ ...k.clamp(2), fontSize: fitSize(v.name, NAME_STEPS), fontWeight: k.f.displayBlack, lineHeight: 0.98, marginTop: 34, marginLeft: -4, textTransform: 'uppercase' }, v.name),
    k.fill(),
  )
}

export default { key: 'character', name: 'Character spotlight', urgent: false, gapDays: 180, titleGap: false, window: 80, find, captions, questions, tags: (p) => p.tags, template }
