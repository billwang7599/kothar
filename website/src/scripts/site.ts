// Page motion for Overview and Features. The rules are in DESIGN.md, "Motion".
//
// - Reveals: each [data-reveal] block gets .in the first time it scrolls into view, and site.css fades and lifts its
//   children in (500ms, staggered by --i). Blocks already on screen at load reveal at once.
// - Smooth jumps: clicks on same-page #links scroll there in 300–600ms (ease-in-out), stopping below the sticky nav
//   (html's scroll-padding-top). The target then takes focus for keyboards and screen readers.
// - Reduced motion (html.still): no reveals and instant jumps.

const root = document.documentElement
const still = root.classList.contains('still')

if (root.classList.contains('motion')) {
  const blocks = [...document.querySelectorAll<HTMLElement>('[data-reveal]')]
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (!e.isIntersecting) return
        e.target.classList.add('in')
        io.unobserve(e.target)
      }),
    { rootMargin: '0px 0px -10% 0px', threshold: 0.12 },
  )
  blocks.forEach((b) => io.observe(b))
}
;(window as unknown as { kotharSite: boolean }).kotharSite = true

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
let jump = 0

function scrollToY(y: number) {
  const from = scrollY
  const max = root.scrollHeight - innerHeight
  const to = Math.max(0, Math.min(y, max))
  const distance = Math.abs(to - from)
  if (still || distance < 2) return window.scrollTo({ top: to, behavior: 'instant' })
  const duration = Math.min(600, Math.max(300, 250 + distance / 8))
  const start = performance.now()
  const id = ++jump
  const step = (now: number) => {
    if (id !== jump) return
    const t = Math.min(1, (now - start) / duration)
    window.scrollTo({ top: from + (to - from) * easeInOut(t), behavior: 'instant' })
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}
// A wheel, touch or key during a jump hands control back to the reader.
for (const type of ['wheel', 'touchstart', 'keydown']) addEventListener(type, () => jump++, { passive: true })

document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const a = (e.target as Element).closest<HTMLAnchorElement>('a[href*="#"]')
  if (!a || a.origin !== location.origin || a.pathname !== location.pathname) return
  const id = decodeURIComponent(a.hash.slice(1))
  const target = id === 'top' || id === '' ? root : document.getElementById(id)
  if (!target) return
  e.preventDefault()
  const pad = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0
  const y = target === root ? 0 : target.getBoundingClientRect().top + scrollY - pad
  scrollToY(y)
  history.pushState(null, '', id === 'top' ? location.pathname : `#${id}`)
  if (target !== root) {
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
    target.focus({ preventScroll: true })
  }
})
