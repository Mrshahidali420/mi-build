// The feedback, contact and advertise forms (MessageForm.astro). The same
// check the Worker runs (checkMessage in src/lib/messages.mjs) runs here
// first, so a mistake is shown without a round trip; then a fresh Turnstile
// ticket goes with the message to /_message. Nothing here is secret.
import { checkMessage, cleanPage, MAX_BODY } from '../lib/messages.mjs'
import { ticket, post } from './turnstile-ticket.js'

// Which fields each form sends. The server refuses any other.
const FIELDS = {
  feedback: ['page', 'name', 'email', 'topic', 'body'],
  contact: ['name', 'email', 'topic', 'body'],
  sponsor: ['name', 'email', 'company', 'website', 'topic', 'budget', 'body'],
}

for (const form of document.querySelectorAll('[data-message-form]')) start(form)

function start(form) {
  const { kind, key } = form.dataset
  const fields = FIELDS[kind]
  if (!fields) return
  const said = form.querySelector('[data-message-said]')
  const check = form.querySelector('[data-message-check]')
  const count = form.querySelector('[data-message-count]')
  const send = form.querySelector('button[type="submit"]')
  const input = (name) => form.elements.namedItem(name)

  const say = (message, bad) => {
    said.textContent = message
    said.classList.toggle('bad', Boolean(bad))
  }

  // The page the reader came from: ?page= when given, else the referrer when
  // it is this site. A bad one is left out.
  const page = input('page')
  if (page) {
    try {
      let given = cleanPage(new URLSearchParams(location.search).get('page') || '')
      if (!given && document.referrer) {
        const from = new URL(document.referrer)
        if (from.origin === location.origin && from.pathname !== location.pathname) given = cleanPage(from.pathname)
      }
      if (given) page.value = given
    } catch {}
  }

  const text = input('body')
  text.addEventListener('input', () => {
    count.textContent = `${[...text.value].length} / ${MAX_BODY}`
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (send.disabled) return
    const body = { kind }
    for (const name of fields) body[name] = input(name)?.value ?? ''
    // A placeholder ticket, so only the reader's own fields are judged here.
    const local = checkMessage({ ...body, token: '-' })
    if (local.error) {
      say(local.error, true)
      input(local.field)?.focus()
      return
    }
    send.disabled = true
    say('Checking your browser…', false)
    try {
      const out = await post('/_message', { ...body, token: await ticket(check, key) })
      if (out.ok) {
        const done = document.createElement('p')
        done.className = 'review-form__said message-form__done'
        done.setAttribute('role', 'status')
        done.textContent = out.data.message || 'Thank you.'
        form.replaceWith(done)
        return
      }
      say(out.data.error || 'Not sent. Try again.', true)
      if (out.data.field) input(out.data.field)?.focus()
    } catch {
      say('Not sent: the connection or the browser check failed. Try again.', true)
    }
    send.disabled = false
  })
}
