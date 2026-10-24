/**
 * Linkvertise on the official read and watch platform links only, never
 * Amazon and never our own pages (owner decision, 23 Oct 2026: the site costs
 * money to run and earns nothing).
 *
 * Linkvertise's script rewrites every <a href> whose address matches the
 * whitelist, once, on DOMContentLoaded. It turns a pattern into a regex by
 * replacing "*" with ".*" and escaping nothing, a pattern with no "*" matches
 * anywhere, and an empty whitelist means every outside link. So the page itself
 * lists its own read and watch links and hands Linkvertise exactly those
 * addresses. The first version guessed from a catalog host list: it caught our
 * own pages ("x.com" in "manhwaindex.com") and missed every "http://" link.
 */

export const LINKVERTISE_ID = 10316435

/**
 * Runs in the browser, as an inline module: after the page is parsed, after
 * the deferred linkvertise.js, before DOMContentLoaded. Self-contained on
 * purpose, because it is sent as its own source text (see lvInit).
 */
export function lvSetup(id) {
  if (typeof linkvertise !== 'function') return // an ad blocker stopped it
  var own = location.hostname.replace(/^www\./, '')
  var never = /(^|\.)(amazon|amzn)\./
  var seen = {}
  var whitelist = []
  var links = document.querySelectorAll('a[data-go="read"][href^="http"], a[data-go="watch"][href^="http"]')
  links.forEach(function (a) {
    var host
    try { host = new URL(a.href).hostname.replace(/^www\./, '') } catch (e) { return }
    if (never.test(host) || host === own || host.slice(-own.length - 1) === '.' + own) return
    // A "*" in the address would turn into ".*" and match other links.
    if (a.href.indexOf('*') !== -1) return
    // The real address, for our click counter after the rewrite.
    a.setAttribute('data-dest', a.href)
    // Linkvertise compares the address without one trailing "/". The "(/*)?"
    // keeps the pattern from being wrapped in "*...*" and is the only wildcard.
    var exact = a.href.replace(/\/$/, '').replace(/[.+?^${}()|[\]\\]/g, '\\$&') + '(/*)?'
    if (!seen[exact]) { seen[exact] = 1; whitelist.push(exact) }
  })
  if (!whitelist.length) return // an empty whitelist would take every link
  linkvertise(id, { whitelist: whitelist, blacklist: ['*amazon.*', '*amzn.*'] })
}

/** The inline script text for Base.astro. */
export const lvInit = (id = LINKVERTISE_ID) => `(${lvSetup.toString()})(${Number(id)})`
