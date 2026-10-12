/**
 * Which kinds of post a run may send: the repo variable FB_POST_TYPES.
 *
 *   unset or empty     only the classic post (a cover and a caption), which is
 *                      what the Page has posted since day one
 *   classic,episode    the classic post and the "episode" template post
 *   episode,where      only those two template posts
 *
 * A template type is OFF until its name is written in the variable, so a new
 * design can never reach the Page before the owner has seen it. A name the
 * site does not have is ignored and reported; a list with no usable name
 * falls back to the classic post, so a typing slip never silences the Page.
 */

export const CLASSIC = 'classic'

/**
 * @param value the variable's text
 * @param known the type names this site has (without 'classic')
 * @returns {{ types: string[], unknown: string[] }} in the order written
 */
export function enabledTypes(value, known = []) {
  const names = String(value || '')
    .split(/[\s,]+/)
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
  const allowed = new Set([CLASSIC, ...known])
  const types = [...new Set(names.filter((name) => allowed.has(name)))]
  const unknown = [...new Set(names.filter((name) => !allowed.has(name)))]
  return { types: types.length ? types : [CLASSIC], unknown }
}

/** True when the run needs nothing but the classic post. */
export const onlyClassic = (types) => types.length === 1 && types[0] === CLASSIC
