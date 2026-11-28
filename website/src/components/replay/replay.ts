// Plays every [data-replay] session on the page once, then leaves it on its final frame. No loops.
//
// Each [data-step] has a sequence like "running:0 done:900": the step takes each state in turn, that many ms after the
// one before. Text marked [data-stream] types in. Steps marked [data-later] are hidden by CSS before the first paint
// (html.js without .still), so the first frame is the session's start. A card starts when it is half in view. The
// page's [data-replay-toggle] button pauses and resumes, and once every card has finished it plays them all again.
//
// With reduced motion, the head script adds html.still: every card shows its final frame and nothing here runs.

type Seq = [state: string, ms: number][]
interface Step {
  el: HTMLElement
  seq: Seq
  later: boolean
  streams: { node: Text; full: string }[]
}

const html = document.documentElement
const roots = [...document.querySelectorAll<HTMLElement>('[data-replay]')]
const toggles = [...document.querySelectorAll<HTMLButtonElement>('[data-replay-toggle]')]
let paused = false
let running = 0

const sleep = (ms: number) =>
  new Promise<void>((done) => {
    let left = ms
    let last = performance.now()
    const tick = (now: number) => {
      if (!paused && !document.hidden) left -= now - last
      last = now
      if (left <= 0) done()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

function parse(root: HTMLElement): Step[] {
  return [...root.querySelectorAll<HTMLElement>('[data-step]')].map((el) => {
    const seq = (el.dataset.seq ?? 'on:0').split(/\s+/).map((p) => {
      const [s, ms] = p.split(':')
      return [s, Number(ms) || 0] as [string, number]
    })
    const streams: Step['streams'] = []
    el.querySelectorAll('[data-stream]').forEach((s) => {
      const walk = document.createTreeWalker(s, NodeFilter.SHOW_TEXT)
      for (let n = walk.nextNode(); n; n = walk.nextNode()) streams.push({ node: n as Text, full: n.textContent ?? '' })
    })
    return { el, seq, later: el.hasAttribute('data-later'), streams }
  })
}

/** The first frame: the early steps in their final state, the later ones hidden. */
function toFirstFrame(steps: Step[]) {
  for (const s of steps) {
    s.el.dataset.state = s.later ? 'hidden' : s.seq[s.seq.length - 1][0]
    for (const t of s.streams) t.node.textContent = s.later ? '' : t.full
  }
}

/** Older lines slide up and fade out at the top only once the session no longer fits its card. */
function fit(root: HTMLElement) {
  root.classList.toggle('over', root.scrollHeight > root.clientHeight + 1)
}

async function stream(step: Step, root: HTMLElement) {
  step.el.classList.add('typing')
  for (const t of step.streams) {
    for (let i = 0; i <= t.full.length; i += 3) {
      t.node.textContent = t.full.slice(0, i)
      fit(root)
      await sleep(24)
    }
    t.node.textContent = t.full
  }
  step.el.classList.remove('typing')
}

function label() {
  const text = running ? (paused ? 'Resume' : 'Pause') : 'Replay'
  for (const b of toggles) {
    b.textContent = text
    b.setAttribute('aria-pressed', String(running > 0 && paused))
  }
}

async function play(root: HTMLElement, steps: Step[], wait: number) {
  running++
  label()
  root.classList.add('playing')
  toFirstFrame(steps)
  fit(root)
  await sleep(wait)
  for (const step of steps) {
    if (!step.later) continue
    await sleep(600)
    for (const [i, [state, ms]] of step.seq.entries()) {
      if (ms) await sleep(ms)
      step.el.dataset.state = state
      fit(root)
      if (i === 0 && step.streams.length) await stream(step, root)
    }
  }
  root.classList.remove('playing')
  running--
  label()
}

if (!html.classList.contains('still') && roots.length) {
  const sessions = roots.map((root) => ({ root, steps: parse(root) }))
  sessions.forEach(({ root, steps }) => {
    toFirstFrame(steps)
    fit(root)
  })
  // Each card starts once, the first time it is half in view.
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (!e.isIntersecting) return
        io.unobserve(e.target)
        const s = sessions.find((x) => x.root === e.target)
        if (s) void play(s.root, s.steps, Number(s.root.dataset.offset) || 0)
      }),
    { threshold: 0.5 },
  )
  roots.forEach((r) => io.observe(r))
  for (const b of toggles) {
    b.hidden = false
    b.addEventListener('click', () => {
      if (running) paused = !paused
      else {
        paused = false
        sessions.forEach(({ root, steps }) => void play(root, steps, Number(root.dataset.offset) / 2 || 0))
      }
      label()
    })
  }
  label()
}
