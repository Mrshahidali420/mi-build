/**
 * The building blocks every template image is made of: boxes, type in the
 * site's two faces, a hairline, a picture placed whole, and the small site
 * mark with the site name that closes every image.
 *
 * A template is a function (view, kit) -> tree. The tree is plain data in
 * the shape satori reads ({ type, props: { style, children } }), so a
 * template can be tested without drawing anything.
 *
 * The look is editorial on purpose: flat colour, big type, the art as the
 * hero, hairlines for structure. No badges, no glows, no card grids.
 */

export const W = 1080
export const H = 1350
export const PAD = 72
export const INNER = W - PAD * 2

const kidsOf = (kids) => {
  const list = kids.flat(Infinity).filter((kid) => kid !== null && kid !== undefined && kid !== false && kid !== '')
  return list.length === 0 ? undefined : list.length === 1 ? list[0] : list
}

/** One element. Empty children are dropped, so a template can write `cond && box(...)`. */
export const h = (type, style, ...kids) => ({ type, props: { style, children: kidsOf(kids) } })

export const box = (style, ...kids) => h('div', { display: 'flex', ...style }, ...kids)
export const row = (style, ...kids) => box({ flexDirection: 'row', ...style }, ...kids)
export const col = (style, ...kids) => box({ flexDirection: 'column', ...style }, ...kids)
/** A flexible gap that pushes what follows to the far edge. */
export const fill = () => box({ flexGrow: 1 })

/** A style that cuts text off (with an ellipsis) after this many lines, whatever its length. */
export const clamp = (lines) => ({ display: 'block', lineClamp: lines })

/** The size of a picture of shape `ratio` (width / height) placed whole inside a box. */
export function contain(ratio, maxWidth, maxHeight) {
  const width = Math.min(maxWidth, maxHeight * ratio)
  return { width: Math.round(width), height: Math.round(width / ratio) }
}

const withAlpha = (hex, alpha) => {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/**
 * The colours of one background.
 *   dark    the site's night colour, cream type, the accent for emphasis
 *   light   cream paper, night type; the accent is a fill there, never type
 *   accent  the accent as the page, night type
 */
export function toneOf(theme, name) {
  const c = theme.color
  if (name === 'light') return { name, bg: c.paper, ink: c.night, soft: withAlpha(c.night, 0.62), line: withAlpha(c.night, 0.2), pop: c.night, block: c.accent }
  if (name === 'accent') return { name, bg: c.accent, ink: c.night, soft: withAlpha(c.night, 0.7), line: withAlpha(c.night, 0.28), pop: c.night, block: c.night }
  return { name: 'dark', bg: c.night, ink: c.paper, soft: withAlpha(c.paper, 0.62), line: withAlpha(c.paper, 0.2), pop: c.accent, block: c.accent }
}

/** Everything a template draws with, bound to one site's theme. */
export function kitOf(theme, marks = {}) {
  const f = theme.font

  /** Text in the display face (names, numbers, headlines). */
  const display = (style, value) => box({ fontFamily: f.display, fontWeight: f.displayBold, lineHeight: 1.08, ...style }, String(value))
  /** Text in the reading face. */
  const body = (style, value) => box({ fontFamily: f.text, fontWeight: f.textRegular, lineHeight: 1.3, ...style }, String(value))
  /** A small spaced label that names the kind of post. Plain type, no shape behind it. */
  const kicker = (value, style = {}) => body({ fontWeight: f.textBold, fontSize: 26, letterSpacing: 5, textTransform: 'uppercase', lineHeight: 1.2, ...style }, value)

  const rule = (color, thickness = 2, style = {}) => box({ height: thickness, backgroundColor: color, alignSelf: 'stretch', flexShrink: 0, ...style })

  /** A picture placed whole inside maxWidth x maxHeight; a flat panel when it is missing. */
  const art = (picture, maxWidth, maxHeight, style = {}) => {
    if (!picture) return box({ width: maxWidth, height: maxHeight, backgroundColor: theme.color.raised, flexShrink: 0, ...style })
    const size = contain(picture.ratio, maxWidth, maxHeight)
    return { type: 'img', props: { src: picture.src, width: size.width, height: size.height, style: { flexShrink: 0, ...style } } }
  }

  /** The closing line of every image: the mark, the site name, the address. */
  const brand = (tone) =>
    row(
      { alignItems: 'center', justifyContent: 'space-between', borderTop: `2px solid ${tone.line}`, paddingTop: 22, flexShrink: 0 },
      row(
        { alignItems: 'center' },
        marks[tone.name] && { type: 'img', props: { src: marks[tone.name], width: 44, height: 44, style: { marginRight: 14 } } },
        // A site may set its name in its wordmark face (font.brand); the display face otherwise.
        display({ fontSize: f.brandSize || 26, color: tone.ink, fontFamily: f.brand || f.display, fontWeight: f.brandWeight || f.displayBold }, theme.name),
      ),
      body({ fontSize: 24, color: tone.soft, fontWeight: f.textMedium }, theme.domain),
    )

  /** The whole image: one background, the standard margins, the brand line last. */
  const page = (tone, ...kids) =>
    box(
      { width: W, height: H, backgroundColor: tone.bg, color: tone.ink, fontFamily: f.text },
      col({ width: INNER, height: H - PAD * 2, marginLeft: PAD, marginTop: PAD }, ...kids, brand(tone)),
    )

  return { theme, f, tone: (name) => toneOf(theme, name), display, body, kicker, rule, art, brand, page, box, row, col, fill, contain, clamp }
}
