# Demo video

Records a short product demo of Kothar driving real engines (Claude Code and pi), then cuts it into a captioned MP4.
Nothing on the agent side is scripted: the prompts in `record.mjs` go to the engines as typed, using their own
default sign-in, and the recording shows whatever they do.

## Record

1. Build the UI: `npm run build -w @kothar/ui`.
2. Install Playwright without saving it: `npm i --no-save playwright && npx playwright install chromium`. You need
   `ffmpeg` too (`brew install ffmpeg`).
3. Make the sample repo, a tiny Python project with one failing test, outside your home folder so no personal path
   shows on screen (the demo used `/tmp/kothar-demo/tipsplit`: `split.py` with `total // people`, `test_split.py` with
   a test expecting 33.33 for 100 split 3 ways, committed on `main`).
4. Start a fresh, throwaway garage with Notes off (the demo turns it on on camera):

   ```sh
   mkdir -p /tmp/kothar-demo/garage
   echo '{"workFolder":"/tmp/kothar-demo/garage/work","extensions":{"notes":{"enabled":false}}}' \
     > /tmp/kothar-demo/garage/settings.json
   KOTHAR_GARAGE=/tmp/kothar-demo/garage KOTHAR_PORT=4417 KOTHAR_TOKEN=demo-token node scripts/demo/serve.ts
   ```

   `serve.ts` runs the core without the fake engine and refuses to start without `KOTHAR_GARAGE`, so the demo never
   touches your real garage.
5. Record a take: `DEMO_REDACT=/Users/<you> node scripts/demo/record.mjs /tmp/kothar-demo/take1`. It writes frames
   and `marks.json` (when each step happened). `DEMO_REDACT` lists strings replaced with `~` wherever they render, and
   the account menu (your email) is hidden. A take costs well under a dollar on Sonnet.

   On a laptop, keep it awake: run the recorder under `caffeinate -i` and plug it in. A Mac that idles into sleep
   freezes the page mid-take (the edit removes those gaps, but steps can time out). `DEMO_FROM=workers` resumes a take
   at the workers step on the same garage, and `DEMO_FROM=reports` resumes one whose workers are already running.

## Cut

`node scripts/demo/edit.mjs /tmp/kothar-demo/take1 demo.mp4 scripts/demo/cut-short.json` builds the 8-second clip
(title, one sped-up Claude Code run with an approval, end card). `cut.json` is the long cut (about 100 seconds, with
some steps in resumed takes `take2b` and `take2c`). Either builds the video from the marks:
a title card, captioned segments (sped-up ones carry a "Sped up N×" badge) and an end card. Edit `cut.json` to
change what's kept, its speed and its captions. Frame gaps over 8 seconds are the computer asleep and are shortened;
check them against `pmset -g log` before trusting a cut. If Homebrew's ffmpeg is broken, `npm i ffmpeg-static` and
put its binary first on `PATH`.
