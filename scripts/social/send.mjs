/**
 * Sending one post, classic or template, for post.mjs.
 *
 * Both kinds end the same way: claim in the ledger (pushed) -> the photo ->
 * the link as the first comment -> settle the claim. A failure after the
 * claim marks it failed; that item is never retried, so nothing posts
 * twice. The error is handed to `onError`, where the chain reads what it
 * says about Facebook's limits (limits.mjs).
 *
 * A reel (a type marked `reel`) is made, sent and commented on the same way:
 * the MP4 instead of the picture, the id of the video instead of the post.
 *
 * A template post draws its picture BEFORE the claim. Drawing touches nothing
 * outside the runner, so a picture that cannot be made (art that will not
 * load) only skips that item for this run and leaves the ledger clean.
 *
 * Each step returns one of STEP: posted, skipped (try another item), none
 * (nothing fits), failed (the owner must look; the run ends red).
 */
import { claim, settle, dayOf, keyOf } from './ledger.mjs'
import { pickNext } from './pick.mjs'
import { slugOf } from './plan.mjs'
import { SITE, commentFor, commentOf, linkOf } from './site.mjs'

export const STEP = { posted: 'posted', skipped: 'skipped', none: 'none', failed: 'failed' }

const quote = (text) => text.split('\n').map((line) => `> ${line}`)

function describe({ heading, image, path, caption, comment, now }) {
  return [`### ${heading}`, `- Image: ${image}`, `- Link: ${linkOf(path)}`, `- Day: ${dayOf(now)}`, '', 'Caption:', '', ...quote(caption), '', 'First comment:', '', ...quote(comment), ''].join('\n')
}

/**
 * The irreversible part: the photo, then the link comment, then the ledger.
 * @param send () => Promise<{ postId }> the Graph call that makes the post
 */
async function publish({ graph, book, entry, send, comment, out, name, onError = () => {} }) {
  let postId
  try {
    postId = (await send()).postId
  } catch (error) {
    onError(error)
    await settle(book, entry.key, { status: 'failed', error: error.message })
    out.push(`**Post failed** for ${name}: ${error.message}. Marked failed in the ledger; not retried.`)
    return STEP.failed
  }
  try {
    const { commentId } = await graph.comment(postId, comment)
    await settle(book, entry.key, { status: 'posted', postId, commentId })
    out.push(`Posted: ${postId}, link comment ${commentId}.`, '')
    return STEP.posted
  } catch (error) {
    onError(error)
    await settle(book, entry.key, { status: 'posted', postId, commentError: error.message })
    out.push(`Posted ${postId}, but **the link comment failed**: ${error.message}. Add the link by hand on Facebook.`)
    return STEP.failed
  }
}

/** The classic post: a cover by its address, and a caption. */
export async function classicStep({ s, graph, book, pools, history, now, day, rng, skip, blockedTags, slotsLeft, out, resolveImage, onError }) {
  const pick = pickNext({ pools, history, now, rng, skip, blockedTags, slotsLeft })
  if (!pick) return STEP.none
  const c = pick.candidate
  const entry = { key: keyOf(day, c.slug, SITE.key), day, slug: c.slug, title: c.title, page: SITE.key, mix: pick.mix, format: pick.format, at: now }
  const claimed = await claim(book, entry, now)
  if (!claimed.ok) {
    skip.add(c.slug)
    out.push(`Skipped ${c.title}: ${claimed.reason}.`, '')
    return STEP.skipped
  }
  // The large cover when the source has one; the record's own address otherwise.
  const image = c.image ? (await resolveImage(c.image)).url : null
  const comment = commentOf(c, { affiliate: s.affiliate })
  out.push(describe({ heading: `${pick.mix.toUpperCase()} · ${pick.format} · ${c.title}`, image, path: c.path, caption: pick.caption, comment, now }))
  if (s.dry) {
    await settle(book, entry.key, { status: 'dry' })
    return STEP.posted
  }
  const send = () => (image ? graph.publishPhoto({ url: image, caption: pick.caption }) : graph.publishText({ message: pick.caption }))
  return publish({ graph, book, entry, send, comment, out, name: c.title, onError })
}

/** The ledger entry of a template post. */
export function typedEntry({ type, post, variant }, day, now) {
  const slug = slugOf(type, post)
  return {
    // A reel is counted on its own daily limit, inside the cap (attempt.mjs).
    ...(type.reel ? { reel: true } : {}),
    // Fan art and cosplay: rare by rule (attempt.mjs), and their picture's id, md5 and rating kept with the post.
    ...(type.rare ? { rare: true, ...(post.record || {}) } : {}),
    key: keyOf(day, slug, SITE.key),
    day,
    slug,
    title: post.title || null,
    page: SITE.key,
    mix: 'type',
    format: `${type.reel ? 'reel' : 'type'}:${type.key}`,
    type: type.key,
    item: post.item,
    gapDays: type.gapDays,
    titleGap: Boolean(type.titleGap),
    variant,
    at: now,
  }
}

/** A template post: the picture is drawn here and sent as a file. */
/** How a drawn post is described, saved by a dry run, and sent: a picture, or a reel. */
function mediumOf(type, made, { graph, caption, sleep }) {
  if (!type.reel) {
    return { line: `drawn on the runner, 1080x1350, ${Math.round(made.jpeg.length / 1024)} KB`, file: 'jpg', bytes: made.jpeg, send: () => graph.publishPhotoFile({ bytes: made.jpeg, caption, filename: `${type.key}.jpg` }) }
  }
  const send = async () => {
    const reel = await graph.publishReel({ bytes: made.mp4, description: caption })
    // The comment needs the reel to exist: wait until Facebook has published it.
    await graph.reelReady?.(reel.videoId, { sleep })
    return reel
  }
  return { line: `a reel made on the runner, 1080x1920, ${made.seconds} s, music ${made.track || 'none'}, ${Math.round(made.mp4.length / 1024)} KB`, file: 'mp4', bytes: made.mp4, send }
}

/** The music of the last reel in the ledger: the next reel takes another track. */
const lastTrack = (history = []) => history.findLast((e) => e.reel && e.track)?.track || null

export async function typedStep({ s, graph, book, plan, now, day, skip, out, render, preview, onError, sleep, history }) {
  const { type, post, caption } = plan
  const name = post.title || `${type.name} (${post.item})`
  let picture
  try {
    picture = await render(type, post, { avoidTrack: lastTrack(history) })
  } catch (error) {
    skip.add(slugOf(type, post))
    out.push(`Skipped ${name}: its picture could not be made (${error.message}).`, '')
    return STEP.skipped
  }
  const entry = { ...typedEntry(plan, day, now), ...(picture.track ? { track: picture.track } : {}) }
  const claimed = await claim(book, entry, now)
  if (!claimed.ok) {
    skip.add(entry.slug)
    out.push(`Skipped ${name}: ${claimed.reason}.`, '')
    return STEP.skipped
  }
  const comment = commentFor(post, { affiliate: s.affiliate })
  const medium = mediumOf(type, picture, { graph, caption, sleep })
  out.push(describe({ heading: `${type.reel ? 'REEL' : 'TEMPLATE'} · ${type.key} · ${name}`, image: medium.line, path: post.path, caption, comment, now }))
  if (s.dry) {
    if (preview) await preview(`${entry.slug.replace(/[^a-z0-9-]+/gi, '-')}.${medium.file}`, medium.bytes)
    await settle(book, entry.key, { status: 'dry' })
    return STEP.posted
  }
  // The chain must know a failed call was a reel's: a reel never stops the other posts (chain.mjs).
  const onFail = (error) => onError?.(type.reel ? Object.assign(error, { reel: true }) : error)
  return publish({ graph, book, entry, send: medium.send, comment, out, name, onError: onFail })
}
