// The owner's message buttons on /my-admin/messages (MessageList.astro). One
// listener for the whole page. A tap posts JSON to /my-admin/api/message,
// which checks the sign-in cookie itself (src/lib/message-actions.js);
// nothing secret lives in this file or in the page.
const ENDPOINT = '/my-admin/api/message'

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

document.addEventListener('click', async (event) => {
  const btn = event.target instanceof Element ? event.target.closest('.acts button[data-message-op]') : null
  if (!btn) return
  const row = btn.closest('[data-message-row]')
  if (!row) return
  const op = btn.dataset.messageOp
  // A delete cannot be undone, so it asks once. Mark done keeps the message
  // under Done, so it does not.
  if (op === 'delete' && !window.confirm('Delete this message for good?')) return
  const status = row.querySelector('.saved')
  const buttons = row.querySelectorAll('.acts button')
  buttons.forEach((b) => { b.disabled = true })
  if (status) status.textContent = 'Saving…'
  const out = await send({ op, id: Number(row.dataset.id) })
  if (status) {
    status.textContent = out.line
    status.classList.toggle('bad', !out.ok)
  }
  if (out.ok) {
    // Done: the buttons go, the line stays, and the row fades so the next
    // one is easy to find.
    row.querySelector('.acts')?.replaceChildren()
    row.classList.add('done')
  } else {
    buttons.forEach((b) => { b.disabled = false })
  }
})
