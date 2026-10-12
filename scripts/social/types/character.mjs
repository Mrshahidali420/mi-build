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
import { top } from './shared.mjs'

export const MIN_POPULARITY = 20_000
/** At most this many characters from one title are offered. */
const PER_TITLE = 2
const PORTRAIT = { width: 440, height: 660 }
const BLOCK_SHIFT = 26
const NAME_STEPS = [[10, 168], [14, 132], [18, 104], [24, 82], [40, 64]]

function toPost(title, member) {
  return {
    item: `char:${member.id}`,
    title: title.title,
    path: title.path,
    label: 'Where to read it',
    tags: [title.section, title.genres[0]],
    name: member.name,
    noun: title.noun,
    sites: top(title.platforms),
    art: { hero: member.image },
    view: { name: clip(member.name, 40), from: clip(title.title, 60), noun: title.noun, sites: top(title.platforms).map((s) => clip(s, 26)) },
  }
}

const find = (data) =>
  data.titles
    .filter((t) => t.verb === 'read' && t.popularity >= MIN_POPULARITY && isDrawable(t.title))
    .flatMap((t) => t.cast.filter((m) => isDrawable(m.name)).slice(0, PER_TITLE).map((m) => toPost(t, m)))

const captions = [
  (p) => [`${p.name} is one of the leads of ${p.title}.`, `You can read the ${p.noun} on ${listOf(p.sites)}.`],
  (p) => [`Character spotlight: ${p.name}, from ${p.title}.`, `Read it on ${listOf(p.sites)}.`],
  (p) => [`Meet ${p.name}, a main character of ${p.title}.`, `The ${p.noun} is on ${listOf(p.sites)}.`],
]

function line(label, value, k, t) {
  return k.col({ borderTop: `2px solid ${t.line}`, paddingTop: 14, paddingBottom: 22 }, k.kicker(label, { color: t.soft, fontSize: 21, letterSpacing: 3 }), k.display({ ...k.clamp(3), fontSize: value.length > 22 ? 34 : 42, lineHeight: 1.08, marginTop: 6 }, value))
}

function template(v, k) {
  const t = k.tone('light')
  const portrait = v.art.hero ? k.contain(v.art.hero.ratio, PORTRAIT.width, PORTRAIT.height) : PORTRAIT
  return k.page(
    t,
    k.row(
      {},
      k.box(
        { position: 'relative', width: portrait.width + BLOCK_SHIFT, height: portrait.height + BLOCK_SHIFT, flexShrink: 0 },
        k.box({ position: 'absolute', left: BLOCK_SHIFT, top: BLOCK_SHIFT, width: portrait.width, height: portrait.height, backgroundColor: t.block }),
        k.art(v.art.hero, PORTRAIT.width, PORTRAIT.height, { position: 'absolute', left: 0, top: 0 }),
      ),
      k.col(
        { marginLeft: 44, width: INNER - portrait.width - BLOCK_SHIFT - 44 },
        k.kicker('Character spotlight', { color: t.ink, marginBottom: 30 }),
        line('From', v.from, k, t),
        line('What it is', v.noun, k, t),
        v.sites.length > 0 && line('Read it on', v.sites.join(', '), k, t),
      ),
    ),
    k.display({ ...k.clamp(2), fontSize: fitSize(v.name, NAME_STEPS), fontWeight: k.f.displayBlack, lineHeight: 0.98, marginTop: 40, marginLeft: -4, textTransform: 'uppercase' }, v.name),
    k.fill(),
  )
}

export default { key: 'character', name: 'Character spotlight', urgent: false, gapDays: 180, titleGap: false, window: 80, find, captions, tags: (p) => p.tags, template }
