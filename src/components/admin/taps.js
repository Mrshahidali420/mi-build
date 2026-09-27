// The owner's buttons on /my-admin (TapList.astro, KeepForm.astro). One
// listener for the whole page. A tap posts JSON to /my-admin/api/rule, which
// checks the sign-in cookie itself (src/lib/admin-actions.js); nothing secret
// lives in this file or in the page.
const ENDPOINT = '/my-admin/api/rule'

const LABEL = { ban: 'Hidden from homepage', pin: 'Kept on homepage', keep: 'On the keep list' }

async function send(body) {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const out = await res.json().catch(() => ({}))
    if (res.ok && out.ok) return { ok: true, line: out.message }
    if (res.status === 401) return { ok: false, line: 'Signed out. Reload the page and sign in again.' }
    return { ok: false, line: `Not saved: ${out.error || `error ${res.status}`}` }
  } catch {
    return { ok: false, line: 'Not saved: no connection. Try again.' }
  }
}

function button(text, op, kind, extra = '') {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = text
  b.dataset.op = op
  b.dataset.kind = kind
  if (extra) b.className = extra
  return b
}

/** Redraw one row's buttons for its new state. Text only, never HTML. */
function draw(row, rule) {
  const acts = row.querySelector('.acts')
  if (!acts) return
  acts.replaceChildren()
  if (rule) {
    const tag = document.createElement('span')
    tag.className = `ruled ${rule}`
    tag.textContent = LABEL[rule] || rule
    acts.append(tag, button('Undo', 'remove', rule, 'quiet'))
  } else if (row.dataset.kind === 'keep') {
    acts.append(button('Add back', 'add', 'keep'))
  } else {
    acts.append(button('Hide from homepage', 'add', 'ban', 'quiet'))
    if (row.dataset.section) acts.append(button('Keep on homepage', 'add', 'pin'))
  }
}

document.addEventListener('click', async (event) => {
  const btn = event.target instanceof Element ? event.target.closest('.acts button[data-op]') : null
  if (!btn) return
  const row = btn.closest('[data-tap-row]')
  if (!row) return
  const { op, kind } = btn.dataset
  const body = { op, kind, id: Number(row.dataset.id) }
  if (op === 'add' && kind === 'pin') body.section = row.dataset.section || ''
  if (op === 'add') body.note = row.dataset.name || ''
  const status = row.querySelector('.saved')
  row.querySelectorAll('.acts button').forEach((b) => { b.disabled = true })
  if (status) status.textContent = 'Saving…'
  const out = await send(body)
  if (status) {
    status.textContent = out.line
    status.classList.toggle('bad', !out.ok)
  }
  if (out.ok) draw(row, op === 'add' ? kind : null)
  else row.querySelectorAll('.acts button').forEach((b) => { b.disabled = false })
})

document.addEventListener('submit', async (event) => {
  const form = event.target instanceof HTMLFormElement && event.target.matches('[data-keep-form]') ? event.target : null
  if (!form) return
  event.preventDefault()
  const input = form.querySelector('input[name="id"]')
  const status = form.querySelector('.saved')
  // The id is the number at the end of an AniList address; a pasted address
  // works too, so the owner can paste straight from the AniList tab.
  const text = String(input?.value || '').trim()
  const match = /^\d{1,10}$/.test(text) ? [text, text] : text.match(/anilist\.co\/(?:manga|anime)\/(\d{1,10})/)
  const id = match ? Number(match[1]) : NaN
  if (!Number.isSafeInteger(id) || id <= 0) {
    if (status) {
      status.textContent = 'Type the number from the AniList address, like 12345.'
      status.classList.add('bad')
    }
    return
  }
  const submit = form.querySelector('button')
  if (submit) submit.disabled = true
  if (status) status.textContent = 'Saving…'
  const out = await send({ op: 'add', kind: 'keep', id })
  if (submit) submit.disabled = false
  if (status) {
    status.textContent = out.ok ? `${out.line} (id ${id})` : out.line
    status.classList.toggle('bad', !out.ok)
  }
  if (out.ok && input) input.value = ''
})
