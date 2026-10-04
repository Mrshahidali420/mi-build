// The comments under a guide (GuideComments.astro). Reads the approved ones
// from /_comments (kept at the edge for five minutes) and draws them with
// textContent only, never as HTML. The form runs the Worker's own check
// first (checkComment in src/lib/guide-comments.mjs), then posts to /_comment
// with a fresh Turnstile ticket. Nothing here is secret.
import { checkComment, MAX_COMMENT } from '../lib/guide-comments.mjs'
import { reviewDate, paragraphsOf } from '../lib/reviews.mjs'
import { ticket, post } from './turnstile-ticket.js'

const DONE = 'Thank you. Your comment shows here once it is approved.'

for (const box of document.querySelectorAll('[data-guide-comments]')) start(box)

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** Name, date and the text as paragraphs; `to` adds "replying to <name>". */
function drawComment(row, { to = null } = {}) {
  const by = el('div', 'review__by')
  by.append(el('b', '', row.name))
  const time = el('time', '', reviewDate(row.created_at))
  time.dateTime = String(row.created_at || '').slice(0, 10)
  by.append(time)
  const parts = [by]
  if (to) parts.push(el('p', 'gc__to', `replying to ${to}`))
  for (const line of paragraphsOf(row.body)) parts.push(el('p', 'review__text gc__text', line))
  return parts
}

function start(box) {
  const guide = box.dataset.guide
  const status = box.querySelector('[data-gc-status]')
  const list = box.querySelector('[data-gc-list]')
  const form = box.querySelector('[data-gc-form]')
  const heading = form.querySelector('[data-gc-form-h]')
  const replying = form.querySelector('[data-gc-replying]')
  const replyingText = form.querySelector('[data-gc-replying-text]')
  const said = form.querySelector('[data-gc-said]')
  const check = form.querySelector('[data-gc-check]')
  const count = form.querySelector('[data-gc-count]')
  const send = form.querySelector('button[type="submit"]')
  const name = form.elements.namedItem('name')
  const text = form.elements.namedItem('body')
  let parent = null

  const say = (message, bad) => {
    said.textContent = message
    said.classList.toggle('bad', Boolean(bad))
  }

  // A reply: the form moves under the comment it answers, and back again.
  const replyTo = (top, li) => {
    parent = top.id
    replyingText.textContent = `Replying to ${top.name}`
    replying.hidden = false
    heading.textContent = 'Reply'
    li.append(form)
    say('', false)
    ;(name.value ? text : name).focus()
  }
  const cancelReply = () => {
    parent = null
    replying.hidden = true
    heading.textContent = 'Add a comment'
    box.append(form)
    say('', false)
  }
  form.querySelector('[data-gc-cancel]').addEventListener('click', cancelReply)

  const draw = (comments) => {
    list.replaceChildren()
    for (const top of comments) {
      const li = el('li', 'review gc__item')
      li.id = `comment-${top.id}`
      li.append(...drawComment(top))
      if (top.replies.length) {
        const replies = el('ol', 'gc__replies')
        for (const reply of top.replies) {
          const r = el('li', 'gc__reply')
          r.id = `comment-${reply.id}`
          r.append(...drawComment(reply, { to: reply.to }))
          replies.append(r)
        }
        li.append(replies)
      }
      const btn = el('button', 'gc__reply-btn', 'Reply')
      btn.type = 'button'
      btn.setAttribute('aria-label', `Reply to ${top.name}`)
      btn.addEventListener('click', () => replyTo(top, li))
      li.append(btn)
      list.append(li)
    }
    list.hidden = comments.length === 0
  }

  status.textContent = 'Loading comments…'
  form.hidden = false
  fetch(`/_comments?guide=${encodeURIComponent(guide)}`, { credentials: 'same-origin' })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const comments = data && data.ok && Array.isArray(data.comments) ? data.comments : null
      if (!comments) {
        status.textContent = 'Comments could not load just now. You can still write one.'
        return
      }
      draw(comments)
      status.textContent = comments.length
        ? `${data.count} ${data.count === 1 ? 'comment' : 'comments'}`
        : 'No comments yet. Be the first.'
    })
    .catch(() => {
      status.textContent = 'Comments could not load just now. You can still write one.'
    })

  text.addEventListener('input', () => {
    count.textContent = `${[...text.value].length} / ${MAX_COMMENT}`
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (send.disabled) return
    const body = { guide, name: name.value, body: text.value, ...(parent ? { parent } : {}) }
    // A placeholder ticket, so only the reader's own fields are judged here.
    const local = checkComment({ ...body, token: '-' })
    if (local.error) {
      say(local.error, true)
      if (local.field === 'name') name.focus()
      else if (local.field === 'body') text.focus()
      return
    }
    send.disabled = true
    say('Checking your browser…', false)
    try {
      const out = await post('/_comment', { ...body, token: await ticket(check, form.dataset.key) })
      if (out.ok) {
        const done = el('p', 'review-form__said gc__done', out.data.message || DONE)
        done.setAttribute('role', 'status')
        form.replaceWith(done)
        return
      }
      say(out.data.error || 'Not sent. Try again.', true)
      if (out.data.field === 'name') name.focus()
      else if (out.data.field === 'body') text.focus()
    } catch {
      say('Not sent: the connection or the browser check failed. Try again.', true)
    }
    send.disabled = false
  })
}
