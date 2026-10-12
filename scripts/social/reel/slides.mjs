/**
 * The slides a reel is made of, drawn with the same kit as the post images
 * (render/parts.mjs): an opening slide, one slide per item, a closing slide
 * with the site name and "link in the first comment".
 *
 * 1080 x 1920. Facebook lays its own buttons and the caption over the top
 * and the bottom of a reel, so everything that matters stays inside SAFE.
 * The look is the posts' own: flat colour, big type, the cover as the hero,
 * hairlines. No badges, no glows.
 */
import { fitSize } from '../text.mjs'
import { REEL } from './video.mjs'

export const SAFE = { top: 190, bottom: 360, side: 84 }
export const INNER = REEL.width - SAFE.side * 2
const COVER = { width: 580, height: 780 }
const BRAND_SCALE = 1.5
/** The opening words: as large as the longest of them allows in the widest display face a site uses, up to HEAD_MAX. */
const HEAD_MAX = 200
const CAPS_WIDTH = 0.84
const headSize = (lines) => Math.min(HEAD_MAX, Math.floor(INNER / (Math.max(1, ...lines.map((line) => line.text.length)) * CAPS_WIDTH)))
/** The big word of an item slide (a rank, a day, a time) by its length, and the closing words by theirs. */
const TAG_STEPS = [[3, 200], [5, 150], [8, 104], [12, 80]]
const END_STEPS = [[16, 104], [28, 84], [60, 66]]
const TITLE_STEPS = [[22, 68], [44, 56], [70, 46]]

/** One slide: the page colour, the safe margins, the site mark and name at the foot. */
function slide(k, t, ...kids) {
  return k.box(
    { width: REEL.width, height: REEL.height, backgroundColor: t.bg, color: t.ink, fontFamily: k.f.text },
    k.col({ width: INNER, height: REEL.height - SAFE.top - SAFE.bottom, marginLeft: SAFE.side, marginTop: SAFE.top }, ...kids, k.brand(t, BRAND_SCALE)),
  )
}

/**
 * The opening slide.
 * @param v { kicker, lines: [{ text, pop }], sub, picture }
 */
export function titleSlide(k, v) {
  const t = k.tone('dark')
  const size = headSize(v.lines)
  return slide(
    k,
    t,
    // The words sit in the middle of the screen, where a reel is watched.
    k.fill(),
    k.kicker(v.kicker, { color: t.soft, fontSize: 38, letterSpacing: 7 }),
    k.rule(t.line, 3, { marginTop: 28 }),
    k.col({ marginTop: 48 }, v.lines.map((line) => k.display({ fontSize: size, fontWeight: k.f.displayBlack, lineHeight: 1, color: line.pop ? t.pop : t.ink, marginLeft: -6, whiteSpace: 'nowrap' }, line.text))),
    v.sub && k.body({ ...k.clamp(3), fontSize: 46, color: t.soft, marginTop: 36, lineHeight: 1.25 }, v.sub),
    v.picture && k.box({ marginTop: 50 }, k.art(v.picture, 460, 620)),
    k.fill(),
  )
}

/**
 * One item.
 * @param v { tag, tagNote, picture, title, note, step } - `tag` is the big word (a rank, a day, a time)
 */
export function itemSlide(k, v) {
  const t = k.tone('dark')
  return slide(
    k,
    t,
    k.row(
      { justifyContent: 'space-between', alignItems: 'flex-end', height: 190 },
      k.row(
        { alignItems: 'flex-end' },
        k.display({ fontSize: fitSize(v.tag, TAG_STEPS), fontWeight: k.f.displayBlack, color: t.pop, lineHeight: 0.9, marginLeft: -8, whiteSpace: 'nowrap' }, v.tag),
        v.tagNote && k.body({ fontSize: 40, color: t.soft, marginLeft: 26, marginBottom: 10 }, v.tagNote),
      ),
      v.step && k.kicker(v.step, { color: t.soft, fontSize: 30, letterSpacing: 4, marginBottom: 14 }),
    ),
    k.rule(t.line, 3, { marginTop: 24 }),
    k.box({ width: INNER, height: COVER.height, marginTop: 34, justifyContent: 'center', alignItems: 'center' }, k.art(v.picture, COVER.width, COVER.height)),
    k.display({ ...k.clamp(2), fontSize: fitSize(v.title, TITLE_STEPS), fontWeight: k.f.displayBlack, lineHeight: 1.06, marginTop: 34 }, v.title),
    v.note && k.body({ ...k.clamp(1), fontSize: 38, color: t.soft, marginTop: 12 }, v.note),
    k.fill(),
  )
}

/**
 * The closing slide: where the link is, and whose reel this is.
 * @param v { head, line }
 */
export function endSlide(k, v) {
  const t = k.tone('accent')
  return slide(
    k,
    t,
    k.fill(),
    k.display({ ...k.clamp(3), fontSize: fitSize(v.head, END_STEPS), fontWeight: k.f.displayBlack, lineHeight: 1.04, marginLeft: -4 }, v.head),
    k.rule(t.ink, 5, { marginTop: 44 }),
    k.row({ alignItems: 'center', marginTop: 44 }, k.box({ width: 34, height: 34, backgroundColor: t.pop, marginRight: 26, flexShrink: 0 }), k.display({ fontSize: 50, lineHeight: 1.1 }, v.line)),
    k.body({ fontSize: 44, color: t.soft, marginTop: 30, fontWeight: k.f.textBold }, k.theme.domain),
    k.fill(),
  )
}

/** The closing words every reel ends on. */
export const END_LINE = 'Link in the first comment'
