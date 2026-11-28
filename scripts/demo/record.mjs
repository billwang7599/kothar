// Records a product demo of Kothar driving REAL engines, as JPEG frames plus a marks.json timeline for edit.mjs.
//
//   node scripts/demo/record.mjs <take dir> [url]
//
// Needs Playwright (`npm i --no-save playwright` and `npx playwright install chromium`), a core from serve.ts on a
// fresh throwaway garage, and the sample repo described in scripts/demo/README.md. Nothing is scripted on the agent
// side: the prompts below go to Claude Code and pi as a user would type them, and whatever they do is what's recorded.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const dir = process.argv[2]
const url = process.argv[3] ?? 'http://127.0.0.1:4417/#token=demo-token'
const repo = process.env.DEMO_REPO ?? '/tmp/kothar-demo/tipsplit'
// DEMO_FROM=workers resumes a take whose garage already has the space: only the workers step runs. DEMO_FROM=reports
// resumes one whose workers are already running, waiting for their reports.
const from = process.env.DEMO_FROM
// Text that must never reach the screen (a home folder, say): replaced in the page as it renders.
const redact = (process.env.DEMO_REDACT ?? '').split(',').filter(Boolean)
if (!dir) throw new Error('usage: record.mjs <take dir> [url]')
mkdirSync(join(dir, 'frames'), { recursive: true })

const PROMPTS = {
  claude: 'One test fails. Run the tests with python3 -m unittest, fix the bug in split.py, and commit.',
  pi: 'Now add a --tip option to the command line in split.py, with a test. Run the tests and commit.',
  workers:
    'Start two workers in parallel: one documents --tip in the README, one makes split_bill reject a negative total, with a test.',
  noteWrite: 'Save a note called "tipsplit" with a two-line summary of what we changed today.',
  noteRead: 'Read my "tipsplit" note and tell me in one sentence what it says.',
}

// Runs in the page before Kothar loads: unfolded tool calls (a real Settings choice), a visible pointer that follows the
// mouse, the account menu hidden (it shows the user's email), and the redacted strings replaced.
const init = ({ redact }) => {
  localStorage.setItem('kothar.showSteps', JSON.stringify({ default: true, chats: {} }))
  const scrub = (root) => {
    if (!redact.length) return
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode())
      for (const r of redact) if (n.nodeValue.includes(r)) n.nodeValue = n.nodeValue.split(r).join('~')
  }
  addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style')
    style.textContent = `button[aria-label="Account"]{visibility:hidden!important}
      #demo-cursor{position:fixed;z-index:2147483647;pointer-events:none;width:22px;height:22px;left:-40px;top:-40px;
        transition:transform .12s ease}
      #demo-cursor.down{transform:scale(.8)}`
    document.head.append(style)
    const cursor = document.createElement('div')
    cursor.id = 'demo-cursor'
    cursor.innerHTML =
      '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l7 19 2.6-7.6L20 11z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    document.body.append(cursor)
    addEventListener('mousemove', (e) => { cursor.style.left = e.clientX - 3 + 'px'; cursor.style.top = e.clientY - 2 + 'px' }, true)
    addEventListener('mousedown', () => cursor.classList.add('down'), true)
    addEventListener('mouseup', () => cursor.classList.remove('down'), true)
    // A MutationObserver here hung the page while agents ran, so the page is swept on a timer instead.
    scrub(document.body)
    setInterval(() => scrub(document.body), 250)
  })
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1536, height: 864 }, deviceScaleFactor: 2 })
await context.addInitScript(init, { redact })
const page = await context.newPage()
page.setDefaultTimeout(15_000)

const frames = []
const marks = []
const now = () => Date.now() / 1000
const mark = (name, extra = {}) => {
  marks.push({ name, t: now(), ...extra })
  console.log(`[${(now() - marks[0]?.t || 0).toFixed(1)}s] ${name}`)
}
const wait = (ms) => page.waitForTimeout(ms)

await page.goto(url)
await wait(2500)
const cdp = await context.newCDPSession(page)
let n = 0
cdp.on('Page.screencastFrame', async (f) => {
  const file = `frames/${String(n++).padStart(6, '0')}.jpg`
  frames.push({ file, t: now() })
  writeFileSync(join(dir, file), Buffer.from(f.data, 'base64'))
  await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
})
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080 })

let mouse = { x: 768, y: 432 }
await page.mouse.move(mouse.x, mouse.y)
// Every action is logged with how long it took, and fails fast instead of waiting on an element forever.
async function timed(what, fn) {
  const t = Date.now()
  try {
    return await fn()
  } finally {
    const ms = Date.now() - t
    if (ms > 4000) console.log(`  slow: ${what} took ${(ms / 1000).toFixed(1)}s`)
  }
}
async function point(locator) {
  let box = await locator.boundingBox({ timeout: 8000 })
  if (!box || box.y < 0 || box.y + box.height > 864) {
    await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {})
    box = await locator.boundingBox({ timeout: 3000 })
  }
  if (!box) throw new Error('not visible')
  const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const steps = Math.max(8, Math.round(Math.hypot(to.x - mouse.x, to.y - mouse.y) / 30))
  await page.mouse.move(to.x, to.y, { steps })
  mouse = to
  await wait(180)
}
async function click(locator, pause = 350) {
  await timed(`click ${locator}`, async () => {
    await point(locator)
    await page.mouse.down()
    await wait(70)
    await page.mouse.up()
  })
  await wait(pause)
}
async function type(locator, text) {
  await click(locator, 150)
  // A few words at a time: per-key typing is far too slow at 2× with the screencast running.
  await timed('type', async () => {
    for (const chunk of text.match(/(\S+\s*){1,3}/g) ?? []) {
      await page.keyboard.insertText(chunk)
      await wait(90)
    }
  })
  await wait(400)
}
const composer = () => page.getByPlaceholder(/Message|Ask|Waiting|Enter/).first()
async function pickModel(name) {
  await page.keyboard.press('Escape')
  await click(page.getByLabel('Model'), 700)
  await click(page.getByRole('option', { name }), 500)
}
const running = async () => (await page.getByRole('button', { name: 'Stop', exact: true }).count()) > 0
// Waits for the turn to finish, approving each request (the first one held on screen longer).
async function runTurn(tag, { firstHold = 2500, max = 240_000 } = {}) {
  const t0 = Date.now()
  let approvals = 0
  await wait(1500)
  while (Date.now() - t0 < max) {
    const approve = page.getByRole('button', { name: 'Approve', exact: true })
    if (await approve.count()) {
      if (approvals === 0) mark(`${tag}:approval`)
      await wait(approvals === 0 ? firstHold : 700)
      await click(approve.first(), 400).catch((e) => console.log('  approve failed', e.message.split('\n')[0]))
      if (approvals === 0) mark(`${tag}:approved`)
      approvals++
      continue
    }
    if (!(await running())) break
    await wait(400)
  }
  mark(`${tag}:done`, { approvals })
  await wait(2200)
}
async function send(tag, text) {
  mark(`${tag}:typing`)
  await type(composer(), text)
  mark(`${tag}:send`)
  await click(page.getByRole('button', { name: 'Send', exact: true }), 200)
}

try {
  if (from === 'workers' || from === 'reports') {
    mark('resume')
    await click(page.locator('nav [data-chat-id]').filter({ hasText: /^tipsplit/ }).first(), 1500)
    await composer().fill('')
    await page.mouse.wheel(0, 8000)
    await wait(1500)
  } else {
    // 1. First run: Get started finds the engines already on this Mac.
    mark('getstarted')
    await page.getByText('Get started', { exact: true }).waitFor()
    await wait(2500)
    await click(page.getByRole('button', { name: 'Turn on' }).first(), 900)
    await click(page.getByRole('button', { name: 'Turn on' }).first(), 1500)
    mark('engines:on')

    // 2. A space for the sample repo.
    await click(page.getByRole('button', { name: 'New space…' }), 600)
    await type(page.locator('[role=dialog] input').last(), 'tipsplit')
    await click(page.getByRole('button', { name: 'Create', exact: true }), 900)
    await click(page.getByRole('button', { name: 'Done', exact: true }), 600)
    mark('space:made')
    await click(page.getByRole('button', { name: 'Context panel' }), 700)
    await click(page.getByRole('tab', { name: 'Context' }), 500)
    await type(page.getByPlaceholder('/path/to/folder'), repo)
    await click(page.getByRole('button', { name: 'Add folder' }), 1200)
    mark('space:folder')
    // Ask before running commands, a per-space switch.
    await click(page.getByRole('tab', { name: 'General' }), 700)
    const row = page.locator('aside').last().getByText('Run commands without asking', { exact: true }).locator('xpath=ancestor::*[.//button][1]')
    await click(row.locator('button').last(), 600)
    await click(page.getByRole('option', { name: 'Off' }), 1200)
    mark('space:perm')
    await click(page.getByRole('button', { name: 'Context panel' }), 600)

    // 3. Claude Code fixes the failing test; commands wait for approval.
    await pickModel('Sonnet 5.5 · Claude Code')
    await send('claude', PROMPTS.claude)
    await runTurn('claude')

    // 4. Same chat, another engine.
    await pickModel('Sonnet 5.5 · pi')
    await send('pi', PROMPTS.pi)
    await runTurn('pi')

    // 5. Extensions: switch on Notes, glance at the Marketplace.
    mark('ext:open')
    await click(page.getByRole('button', { name: /Settings/ }).first(), 900)
    await click(page.getByText('Built-in extensions', { exact: true }), 1200)
    mark('ext:list')
    const notes = page.locator('[role=dialog] [role=switch][aria-label=Notes]')
    await point(notes)
    await wait(900)
    await click(notes, 1500)
    mark('ext:notes-on')
    await click(page.getByText('Community hub', { exact: true }), 900)
    await click(page.getByRole('button', { name: 'Browse…' }), 2500)
    mark('ext:marketplace')
    await click(page.getByText('Hello', { exact: true }).first(), 2500)
    await page.keyboard.press('Escape')
    await wait(500)
    await page.keyboard.press('Escape')
    await wait(800)
    mark('ext:closed')

    // 6. One extension, both engines: pi writes the note, Claude Code reads it.
    await send('note-pi', PROMPTS.noteWrite)
    await runTurn('note-pi')
    await pickModel('Sonnet 5.5 · Claude Code')
    await send('note-claude', PROMPTS.noteRead)
    await runTurn('note-claude')
    await click(page.locator('nav').getByText('Notes', { exact: true }), 1200)
    await click(page.getByText('tipsplit', { exact: true }).last(), 2500).catch(() => {})
    mark('notes:popup')
    await wait(1500)
    await page.keyboard.press('Escape')
    await wait(800)
    mark('notes:closed')

  }

  // 7. Workers in parallel.
  const workerRows = page.locator('nav [data-chat-id]').filter({ hasText: 'worker' })
  if (from !== 'reports') {
    await send('workers', PROMPTS.workers)
    await workerRows.nth(1).waitFor({ timeout: 120_000 })
    mark('workers:started')
    await runTurn('workers-lead')
    await click(workerRows.first(), 3500)
    mark('workers:peek')
    await click(page.locator('nav [data-chat-id]').filter({ hasText: /^tipsplit/ }).first(), 800)
    mark('workers:back')
  }
  // Each worker's report lands in the lead's chat as a card (Merge, Squash, Keep, Discard) and wakes the lead.
  const t0 = Date.now()
  let idleSince = 0
  let workerApprovals = 0
  while (Date.now() - t0 < 420_000) {
    // A worker's requests come to the lead's chat, since the space asks before commands.
    const approve = page.getByRole('button', { name: 'Approve', exact: true })
    if (await approve.count()) {
      if (workerApprovals === 0) mark('workers:approval')
      await wait(workerApprovals === 0 ? 2500 : 800)
      await click(approve.first(), 500).catch((e) => console.log('  approve failed', e.message.split('\n')[0]))
      if (workerApprovals === 0) mark('workers:approved')
      workerApprovals++
      continue
    }
    const reports = await page.getByRole('button', { name: 'Squash', exact: true }).count()
    if (reports < 2 || (await running())) idleSince = 0
    else if (!idleSince) idleSince = Date.now()
    else if (Date.now() - idleSince > 6000) break
    await wait(1000)
  }
  mark('workers:reported')
  await page.mouse.wheel(0, 6000)
  await wait(3500)
  mark('end')
} catch (error) {
  mark('error', { message: String(error?.message ?? error).split('\n')[0] })
  await page.screenshot({ path: join(dir, 'error.png') })
} finally {
  await cdp.send('Page.stopScreencast').catch(() => {})
  await wait(300)
  writeFileSync(join(dir, 'marks.json'), JSON.stringify({ frames, marks }, null, 1))
  await browser.close()
}
