// The stars and the review form on a title page (Ratings.astro). It travels
// on every title page, so it is small: the review rules (the link check) load
// only when a reader opens the form, and Turnstile only when it is needed.
//
// One vote per browser per title is kept in this browser under mi_rated; the
// Worker also refuses a repeat from the same address and browser that day.
// Nothing here is secret. Every check that matters runs again on the server
// (src/lib/reviews-api.js).
const RATED_KEY = 'mi_rated'
const RATED_MAX = 500
const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
// How long a reader may take on a Turnstile challenge, if one ever shows.
const TICKET_WAIT = 60000

const box = document.querySelector('[data-rate]')
if (box) start(box)

function rated() {
  try {
    const map = JSON.parse(localStorage.getItem(RATED_KEY) || '{}')
    return map && typeof map === 'object' ? map : {}
  } catch {
    return {}
  }
}

function remember(id, stars) {
  try {
    const map = rated()
    map[id] = stars
    const keys = Object.keys(map)
    if (keys.length > RATED_MAX) delete map[keys[0]]
    localStorage.setItem(RATED_KEY, JSON.stringify(map))
  } catch {
    // Private mode: the server still blunts a repeat.
  }
}

// The half-hour pass the visit counter already earned with Turnstile
// (Base.astro keeps it in this tab). A vote can travel with it, so most taps
// need no second check. A minute of headroom, so it never dies in flight.
function livePass() {
  try {
    const kept = JSON.parse(sessionStorage.getItem('mi_pass') || 'null')
    return kept && kept.dies > Date.now() + 60000 ? String(kept.pass) : ''
  } catch {
    return ''
  }
}

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
async function ticket(holder, sitekey) {
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

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok && data.ok === true, status: res.status, data }
}

// The rating card after a vote, in the words the server chose
// (ratingWords in src/lib/reviews.mjs).
function showRating(root, data) {
  const sum = root.querySelector('[data-rate-sum]')
  if (!sum || typeof data.big !== 'string') return
  sum.querySelector('[data-rate-big]').textContent = data.big
  sum.querySelector('[data-rate-line]').textContent = data.note || ''
  const avg = Number(data.avg)
  const fill = data.show && avg >= 1 && avg <= 5 ? Math.round(avg * 20) : 0
  sum.querySelector('[data-rate-meter]').style.setProperty('--fill', `${fill}%`)
  sum.toggleAttribute('data-show', Boolean(data.show))
}

function start(root) {
  const { id, kind, slug, key } = root.dataset
  const group = root.querySelector('[data-rate-stars]')
  const buttons = [...root.querySelectorAll('[data-rate-stars] button')]
  const said = root.querySelector('[data-rate-said]')
  const check = root.querySelector('[data-rate-check]')
  let busy = false

  const paint = (n) => {
    for (const b of buttons) {
      const at = Number(b.dataset.stars)
      b.classList.toggle('on', at <= n)
      b.setAttribute('aria-pressed', String(at === n))
    }
  }
  const lock = (text) => {
    group.dataset.locked = '1'
    for (const b of buttons) b.disabled = true
    said.textContent = text
  }
  const unlock = () => {
    delete group.dataset.locked
    for (const b of buttons) b.disabled = false
  }

  const mine = Number(rated()[id]) || 0
  if (mine) {
    paint(mine)
    lock(`You rated it ${mine} of 5. Thank you.`)
  }

  group.addEventListener('click', async (event) => {
    const button = event.target instanceof Element ? event.target.closest('button[data-stars]') : null
    if (!button || busy || group.dataset.locked) return
    const stars = Number(button.dataset.stars)
    busy = true
    paint(stars)
    lock('Saving…')
    try {
      const pass = livePass()
      let out = pass
        ? await post('/_vote', { kind, slug, stars, pass })
        : await post('/_vote', { kind, slug, stars, token: await ticket(check, key) })
      // The pass died or was refused: one more try with a fresh ticket.
      if (!out.ok && out.status === 403 && pass) {
        out = await post('/_vote', { kind, slug, stars, token: await ticket(check, key) })
      }
      if (out.ok) {
        remember(id, stars)
        showRating(root, out.data)
        said.textContent = `Thank you. You rated it ${stars} of 5.`
        const score = root.querySelector('#rv-stars')
        if (score && !score.value) score.value = String(stars)
      } else {
        paint(0)
        unlock()
        said.textContent = out.data.error || 'Not saved. Try again.'
      }
    } catch {
      paint(0)
      unlock()
      said.textContent = 'Not saved: the connection or the browser check failed. Try again.'
    }
    busy = false
  })

  wireForm(root, { id, kind, slug, key })
}

function wireForm(root, { id, kind, slug, key }) {
  const details = root.querySelector('[data-review]')
  const form = root.querySelector('[data-review-form]')
  if (!details || !form) return
  const text = form.querySelector('textarea[name="text"]')
  const name = form.querySelector('input[name="name"]')
  const score = form.querySelector('select[name="stars"]')
  const count = form.querySelector('[data-review-count]')
  const said = form.querySelector('[data-review-said]')
  const check = form.querySelector('[data-review-check]')
  const send = form.querySelector('button[type="submit"]')
  const max = Number(text.getAttribute('maxlength')) || 1500

  // The same rules the server runs, loaded the first time the form opens.
  let rules = null
  const loadRules = () =>
    rules ? Promise.resolve(rules) : import('../lib/reviews.mjs').then((m) => (rules = m))

  const say = (message, bad) => {
    said.textContent = message
    said.classList.toggle('bad', Boolean(bad))
  }

  details.addEventListener('toggle', () => {
    if (!details.open) return
    loadRules().catch(() => {})
    const mine = Number(rated()[id]) || 0
    if (mine && !score.value) score.value = String(mine)
  })

  // Warn about a link while the reader types, not only on send.
  let pause = 0
  text.addEventListener('input', () => {
    count.textContent = `${[...text.value].length} / ${max}`
    clearTimeout(pause)
    pause = setTimeout(async () => {
      const r = await loadRules().catch(() => null)
      if (!r) return
      const link = r.linkProblem(text.value)
      if (link) say(r.linkMessage(link), true)
      else if (said.classList.contains('bad')) say('', false)
    }, 300)
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (send.disabled) return
    const r = await loadRules().catch(() => null)
    const body = {
      kind,
      slug,
      name: name.value,
      text: text.value,
      stars: score.value ? Number(score.value) : null,
    }
    if (r) {
      // A placeholder ticket, so only the reader's own fields are judged here.
      const local = r.checkReview({ ...body, token: '-' })
      if (local.error) {
        say(local.error, true)
        const field = { name, text, stars: score }[local.field]
        if (field) field.focus()
        return
      }
    }
    send.disabled = true
    say('Checking your browser…', false)
    try {
      const out = await post('/_review', { ...body, token: await ticket(check, key) })
      if (out.ok) {
        form.replaceChildren()
        const done = document.createElement('p')
        done.className = 'review-form__said'
        done.setAttribute('role', 'status')
        done.textContent = out.data.message || 'Thank you.'
        form.append(done)
        return
      }
      say(out.data.error || 'Not sent. Try again.', true)
    } catch {
      say('Not sent: the connection or the browser check failed. Try again.', true)
    }
    send.disabled = false
  })
}
