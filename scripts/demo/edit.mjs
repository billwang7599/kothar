// Cuts a take from record.mjs into the demo video: title card, captioned segments (sped-up ones say so), end card.
//
//   node scripts/demo/edit.mjs <take dir> <out.mp4> [cut.json]
//
// cut.json is a list of steps, run in order:
//   { "card": "Title", "sub": "Smaller line", "seconds": 4 }
//   { "from": "<mark>", "to": "<mark>", "speed": 1, "caption": "One line", "pad": [0, 0], "take": "take2b", "top": true }
// from/to name marks from marks.json ("start" is the first frame, "end" the last); pad shifts them by seconds. take
// names another take folder beside <take dir> (a resumed take); top puts the caption at the top. A gap of more than SLEEP_GAP seconds between frames
// is the computer asleep (nothing ran or rendered), so it's shortened to half a second.
// Needs ffmpeg and Playwright (captions and cards are rendered as HTML).
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const [dir, out, cutFile] = process.argv.slice(2)
if (!dir || !out) throw new Error('usage: edit.mjs <take dir> <out.mp4> [cut.json]')
const W = 1920
const H = 1080
const FPS = 30
const SLEEP_GAP = 8
const cut = JSON.parse(readFileSync(cutFile ?? new URL('./cut.json', import.meta.url), 'utf8'))
const ff = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })
const encode = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS)]

// Each take as a constant-rate video on its own timeline: each frame lasts until the next one arrived, sleep gaps cut.
const takes = new Map()
function take(name) {
  const root = name ? join(dir, '..', name) : dir
  if (takes.has(root)) return takes.get(root)
  const { frames, marks } = JSON.parse(readFileSync(join(root, 'marks.json'), 'utf8'))
  const work = join(root, 'edit')
  mkdirSync(work, { recursive: true })
  // Wall-clock time to video time, with each sleep gap shortened.
  const gaps = []
  for (let i = 1; i < frames.length; i++) {
    const gap = frames[i].t - frames[i - 1].t
    if (gap > SLEEP_GAP) gaps.push({ at: frames[i - 1].t, cut: gap - 0.5 })
  }
  const t0 = frames[0].t
  const time = (t) => t - t0 - gaps.filter((g) => g.at < t).reduce((sum, g) => sum + Math.min(g.cut, t - g.at), 0)
  const last = time(frames.at(-1).t) + 1
  const list = frames.map((f, i) => {
    const next = frames[i + 1] ? time(frames[i + 1].t) : last
    return `file '${resolve(root, f.file)}'\nduration ${(next - time(f.t)).toFixed(4)}`
  })
  writeFileSync(join(work, 'frames.txt'), `${list.join('\n')}\nfile '${resolve(root, frames.at(-1).file)}'\n`)
  const base = join(work, 'base.mp4')
  ff('-f', 'concat', '-safe', '0', '-i', join(work, 'frames.txt'), '-vf', `scale=${W}:${H}:flags=lanczos,fps=${FPS}`, ...encode, base)
  const at = (mark, pad = 0) => {
    if (mark === 'start') return pad
    if (mark === 'end') return last + pad
    const m = marks.find((m) => m.name === mark)
    if (!m) throw new Error(`no mark ${mark} in ${root}`)
    return time(m.t) + pad
  }
  if (gaps.length) console.log(`${root}: ${gaps.length} sleep gaps, ${gaps.reduce((s, g) => s + g.cut, 0).toFixed(0)}s cut`)
  const value = { base, at }
  takes.set(root, value)
  return value
}
const work = join(dir, 'edit')
mkdirSync(work, { recursive: true })

// 2. Captions and cards, drawn in a browser.
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: W, height: H } })
const font = `'Helvetica Neue', Helvetica, Arial, sans-serif;`
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
// Loaded from the file, since the headless browser doesn't resolve system font names (macOS; others fall back).
const FONT_FILE = '/System/Library/Fonts/SFNS.ttf'
async function png(file, html, transparent) {
  const page_ = `<html><head><style>@font-face{font-family:Demo;src:url("file://${FONT_FILE}")}</style></head>
    <body style="margin:0;width:${W}px;height:${H}px;font-family:Demo,${font}${transparent ? 'background:transparent' : ''}">${html}</body></html>`
  writeFileSync(`${file}.html`, page_)
  await page.goto(`file://${resolve(file)}.html`)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: file, omitBackground: transparent })
}
const caption = (text, speed, top) => `
  <div style="position:absolute;left:0;right:0;${top ? 'top:84px' : 'bottom:118px'};display:flex;justify-content:center">
    <div style="background:rgba(17,24,39,.88);color:#fff;font-size:38px;font-weight:600;letter-spacing:-.2px;
      padding:16px 30px;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.25)">${esc(text)}</div></div>
  ${speed > 1 ? `<div style="position:absolute;right:36px;top:76px;background:rgba(17,24,39,.8);color:#fff;font-size:24px;
      font-weight:600;padding:8px 16px;border-radius:10px">Sped up ${speed}×</div>` : ''}`
const card = (title, sub) => `
  <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;
    background:#f7f7f8;color:#111827;text-align:center">
    <div style="font-size:84px;font-weight:700;letter-spacing:-2px">${esc(title)}</div>
    ${sub ? `<div style="margin-top:26px;font-size:40px;color:#4b5563;max-width:1400px;line-height:1.3">${esc(sub)}</div>` : ''}
  </div>`

// 3. Each step as a clip, then all joined.
const clips = []
for (const [i, step] of cut.entries()) {
  const clip = join(work, `clip${String(i).padStart(2, '0')}.mp4`)
  if (step.card) {
    const img = join(work, `card${i}.png`)
    await png(img, card(step.card, step.sub), false)
    ff('-loop', '1', '-t', String(step.seconds ?? 4), '-i', img, '-vf', `fps=${FPS},format=yuv420p`, ...encode, clip)
  } else {
    const [padA, padB] = step.pad ?? [0, 0]
    const { base, at } = take(step.take)
    const a = Math.max(0, at(step.from, padA))
    const b = at(step.to, padB)
    const speed = step.speed ?? 1
    const img = join(work, `cap${i}.png`)
    await png(img, step.caption ? caption(step.caption, speed, step.top) : '', true)
    ff('-ss', a.toFixed(3), '-to', b.toFixed(3), '-i', base, '-i', img, '-filter_complex',
      `[0:v]setpts=(PTS-STARTPTS)/${speed},fps=${FPS}[v];[v][1:v]overlay=0:0,format=yuv420p`, '-an', ...encode, clip)
    console.log(`clip ${i}: ${step.from}→${step.to} ${(b - a).toFixed(1)}s at ${speed}× = ${((b - a) / speed).toFixed(1)}s`)
  }
  clips.push(clip)
}
await browser.close()
writeFileSync(join(work, 'clips.txt'), clips.map((c) => `file '${resolve(c)}'`).join('\n'))
ff('-f', 'concat', '-safe', '0', '-i', join(work, 'clips.txt'), '-c', 'copy', '-movflags', '+faststart', out)
const seconds = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim()
console.log(`${out}: ${Number(seconds).toFixed(1)}s`)
