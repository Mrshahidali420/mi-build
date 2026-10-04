// One fresh Turnstile ticket for a reader's form, and the JSON post that
// carries it. Shared by the review form (ratings.js) and the message forms
// (message-form.js). Turnstile loads only when a form is sent.
const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
// How long a reader may take on a Turnstile challenge, if one ever shows.
const TICKET_WAIT = 60000

let loading = null
function turnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      // Base.astro may already be fetching the same script for the visit
      // counter, and Turnstile refuses to be loaded twice, so wait for that one.
      if (!document.querySelector('script[src^="https://challenges.cloudflare.com/turnstile/"]')) {
        const tag = document.createElement('script')
        tag.src = TURNSTILE_SRC
        tag.async = true
        tag.onerror = () => reject(new Error('turnstile'))
        document.head.appendChild(tag)
      }
      let waited = 0
      const tick = setInterval(() => {
        waited += 100
        if (window.turnstile) {
          clearInterval(tick)
          resolve(window.turnstile)
        } else if (waited > 15000) {
          clearInterval(tick)
          reject(new Error('turnstile'))
        }
      }, 100)
    })
    loading.catch(() => {
      loading = null
    })
  }
  return loading
}

/** One fresh Turnstile ticket. Usually invisible; a challenge shows in `holder`. */
export async function ticket(holder, sitekey) {
  const ts = await turnstile()
  return new Promise((resolve, reject) => {
    let id = null
    const end = (fn, value) => {
      clearTimeout(timer)
      try {
        if (id !== null) ts.remove(id)
      } catch {}
      fn(value)
    }
    const timer = setTimeout(() => end(reject, new Error('slow')), TICKET_WAIT)
    try {
      id = ts.render(holder, {
        sitekey,
        appearance: 'interaction-only',
        callback: (token) => end(resolve, token),
        'error-callback': () => end(reject, new Error('check')),
        'expired-callback': () => end(reject, new Error('expired')),
      })
    } catch (e) {
      end(reject, e)
    }
  })
}

export async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok && data.ok === true, status: res.status, data }
}
