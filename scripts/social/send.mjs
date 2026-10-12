/**
 * Sending one post, classic or template, for post.mjs.
 *
 * Both kinds end the same way: claim in the ledger (pushed) -> the photo ->
 * the link as the first comment -> settle the claim. A failure after the
 * claim marks it failed and stops the run; nothing is retried, so nothing
 * posts twice.
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
async function publish({ graph, book, entry, send, comment, out, name }) {
  let postId
  try {
    postId = (await send()).postId
  } catch (error) {
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
    await settle(book, entry.key, { status: 'posted', postId, commentError: error.message })
    out.push(`Posted ${postId}, but **the link comment failed**: ${error.message}. Add the link by hand on Facebook.`)
    return STEP.failed
  }
}

/** The classic post: a cover by its address, and a caption. */
export async function classicStep({ s, graph, book, pools, history, now, day, rng, skip, blockedTags, slotsLeft, out, resolveImage }) {
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
  return publish({ graph, book, entry, send, comment, out, name: c.title })
}

/** The ledger entry of a template post. */
export function typedEntry({ type, post, variant }, day, now) {
  const slug = slugOf(type, post)
  return {
    key: keyOf(day, slug, SITE.key),
    day,
    slug,
    title: post.title || null,
    page: SITE.key,
    mix: 'type',
    format: `type:${type.key}`,
    type: type.key,
    item: post.item,
    gapDays: type.gapDays,
    titleGap: Boolean(type.titleGap),
    variant,
    at: now,
  }
}

/** A template post: the picture is drawn here and sent as a file. */
export async function typedStep({ s, graph, book, plan, now, day, skip, out, render, preview }) {
  const { type, post, caption } = plan
  const name = post.title || `${type.name} (${post.item})`
  let picture
  try {
    picture = await render(type, post)
  } catch (error) {
    skip.add(slugOf(type, post))
    out.push(`Skipped ${name}: its picture could not be made (${error.message}).`, '')
    return STEP.skipped
  }
  const entry = typedEntry(plan, day, now)
  const claimed = await claim(book, entry, now)
  if (!claimed.ok) {
    skip.add(entry.slug)
    out.push(`Skipped ${name}: ${claimed.reason}.`, '')
    return STEP.skipped
  }
  const comment = commentFor(post, { affiliate: s.affiliate })
  const size = `${Math.round(picture.jpeg.length / 1024)} KB`
  out.push(describe({ heading: `TEMPLATE · ${type.key} · ${name}`, image: `drawn on the runner, 1080x1350, ${size}`, path: post.path, caption, comment, now }))
  if (s.dry) {
    if (preview) await preview(`${entry.slug.replace(/[^a-z0-9-]+/gi, '-')}.jpg`, picture.jpeg)
    await settle(book, entry.key, { status: 'dry' })
    return STEP.posted
  }
  const send = () => graph.publishPhotoFile({ bytes: picture.jpeg, caption, filename: `${type.key}.jpg` })
  return publish({ graph, book, entry, send, comment, out, name })
}
