import { createHash, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, resolve, sep } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import type { Core } from './core.ts'
import { UploadTooBig } from './uploads.ts'
import { BAD_TOKEN_CLOSE_CODE, IMAGE_TYPES, type CoreMessage } from './shared.ts'

// Hashing first gives equal lengths, which timingSafeEqual needs, without leaking the token's length.
const digest = (text: string) => createHash('sha256').update(text).digest()
const sameToken = (given: string, token: string) => timingSafeEqual(digest(given), digest(token))

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

const ATTACHMENT_PATH = /^\/chats\/([^/]+)\/attachments\/([^/]+)$/
const CHAT_IMAGE_PATH = /^\/chats\/([^/]+)\/image$/
// Why a chat's image wasn't served, as the status the window reads (file-links.ts ChatImageRefusal).
const REFUSED_STATUS = { 'not-found': 404, 'not-image': 415, 'too-big': 413 } as const
const EXTENSION_FILE_PATH = /^\/extensions\/([a-z0-9-]+)\/files$/
// Files streamed ahead of their message (uploads.ts): POST /uploads, DELETE /uploads/<id>.
const UPLOADS_PATH = /^\/uploads(?:\/([0-9a-f]{32}))?$/

export async function startServer(options: {
  core: Core
  port: number
  uiOrigin: string
  token: string
  uiDir?: string
  // The kothar CLI's token (cli-access.ts), taken only on a WebSocket with no Origin, which no browser can open.
  // Without it, such sockets are refused as before.
  cliToken?: string
}) {
  const { core, port, uiOrigin, token, cliToken } = options
  const uiDir = options.uiDir && resolve(options.uiDir)
  const serveUi: RequestListener = (request, response) => {
    if (!uiDir) return response.writeHead(426).end()
    const index = join(uiDir, 'index.html')
    let file = join(uiDir, new URL(request.url ?? '/', 'http://ui').pathname)
    if (!file.startsWith(uiDir + sep) || !existsSync(file) || !statSync(file).isFile()) file = index
    if (!existsSync(file)) return response.writeHead(404).end(`No UI build in ${uiDir}`)
    response.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(response)
  }
  let serveMcp: ReturnType<Core['serveMcp']> | undefined
  // No time limit on a whole request (Node's default is 5 minutes), so a file of many GB can stream in (POST /uploads).
  // It's a loopback server that checks Origin and token.
  const http = createServer({ requestTimeout: 0 }, (request, response) => {
    const url = new URL(request.url ?? '/', 'http://core')
    if (serveMcp && url.pathname === '/mcp') {
      return void serveMcp(request, response).catch(() => response.headersSent || response.writeHead(500).end())
    }
    const upload = url.pathname.match(UPLOADS_PATH)
    if (upload) {
      const cors = {
        'access-control-allow-origin': uiOrigin,
        'access-control-allow-methods': 'POST, DELETE',
        'access-control-allow-headers': 'content-type',
      }
      if (request.method === 'OPTIONS') return response.writeHead(204, cors).end()
      // Only the window sends files: its Origin and its token.
      if (request.headers.origin !== uiOrigin) return response.writeHead(403).end()
      if (!sameToken(url.searchParams.get('token') ?? '', token)) return response.writeHead(401, cors).end()
      if (request.method === 'DELETE' && upload[1]) {
        core.dropUpload(upload[1])
        return response.writeHead(204, cors).end()
      }
      if (request.method !== 'POST' || upload[1]) return response.writeHead(405, cors).end()
      const length = Number(request.headers['content-length'])
      return void core.receiveUpload(request, Number.isSafeInteger(length) ? length : undefined).then(
        (staged) => response.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(staged)),
        (error) => {
          if (response.headersSent) return
          // Past the largest attachment: why, for the composer, and the connection closed so the rest isn't sent.
          if (error instanceof UploadTooBig) {
            const json = { ...cors, 'content-type': 'application/json', connection: 'close' }
            return void response.writeHead(413, json).end(JSON.stringify({ error: error.message }))
          }
          response.writeHead(500, cors).end()
        },
      )
    }
    const attachment = url.pathname.match(ATTACHMENT_PATH)
    if (attachment) {
      if (!sameToken(url.searchParams.get('token') ?? '', token)) return response.writeHead(401).end()
      let found
      try {
        found = core.attachment(decodeURIComponent(attachment[1]!), decodeURIComponent(attachment[2]!))
      } catch {}
      if (!found || !existsSync(found.path)) return response.writeHead(404).end()
      // The UI shares this origin in the desktop app, so nothing but a plain image or a PDF may render here.
      const inline = [...IMAGE_TYPES, 'application/pdf'].includes(found.mimeType)
      response.writeHead(200, {
        'content-type': inline ? found.mimeType : 'application/octet-stream',
        'x-content-type-options': 'nosniff',
        'content-security-policy': 'sandbox',
        'access-control-allow-origin': uiOrigin,
        ...(!inline && { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(found.name)}` }),
      })
      return void createReadStream(found.path).pipe(response)
    }
    // A picture a chat's reply shows inline (core.chatImage): only from the chat's own places, only picture types.
    const chatImage = url.pathname.match(CHAT_IMAGE_PATH)
    if (chatImage) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return response.writeHead(405).end()
      if (!sameToken(url.searchParams.get('token') ?? '', token)) return response.writeHead(401).end()
      let found
      try {
        found = core.chatImage(decodeURIComponent(chatImage[1]!), url.searchParams.get('path') ?? '')
      } catch {}
      const cors = { 'access-control-allow-origin': uiOrigin }
      if (!found) return response.writeHead(404, cors).end()
      if ('error' in found) return response.writeHead(REFUSED_STATUS[found.error], cors).end()
      response.writeHead(200, {
        'content-type': found.mimeType,
        'content-length': String(found.size),
        'x-content-type-options': 'nosniff',
        // An SVG opened on its own runs nothing and loads nothing; through <img>, as the window shows it, it never
        // could. The UI shares this origin in the desktop app.
        'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        'cache-control': 'no-cache',
        ...cors,
      })
      if (request.method === 'HEAD') return response.end()
      return void createReadStream(found.path).pipe(response)
    }
    // A picture from an extension's own folders (core.extensionFile), such as one pasted into a note.
    const extensionFile = url.pathname.match(EXTENSION_FILE_PATH)
    if (extensionFile) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return response.writeHead(405).end()
      if (!sameToken(url.searchParams.get('token') ?? '', token)) return response.writeHead(401).end()
      const found = core.extensionFile(extensionFile[1]!, url.searchParams.get('path') ?? '')
      if (!found) return response.writeHead(404).end()
      response.writeHead(200, {
        'content-type': found.mimeType,
        'x-content-type-options': 'nosniff',
        'content-security-policy': 'sandbox',
        'cache-control': 'no-cache',
        'access-control-allow-origin': uiOrigin,
      })
      if (request.method === 'HEAD') return response.end()
      return void createReadStream(found.path).pipe(response)
    }
    serveUi(request, response)
  })
  const wss = new WebSocketServer({
    server: http,
    verifyClient: (info, accept) =>
      accept(info.origin === uiOrigin || (!info.req.headers.origin && !!cliToken), 403, 'Origin not allowed'),
  })
  const send = (socket: WebSocket, message: CoreMessage) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }

  core.onMessage((message) => wss.clients.forEach((socket) => send(socket, message)))

  wss.on('connection', (socket, request) => {
    const given = new URL(request.url ?? '/', 'ws://core').searchParams.get('token') ?? ''
    // The UI's origin takes the UI's token; a socket with no Origin (the CLI) takes only the CLI's.
    const expected = request.headers.origin ? token : cliToken
    if (!expected || !sameToken(given, expected)) return socket.close(BAD_TOKEN_CLOSE_CODE, 'Missing or wrong token')
    send(socket, {
      type: 'snapshot',
      engines: core.engines(),
      chats: core.chats(),
      accounts: core.accounts(),
      contextDefaults: core.contextDefaults(),
      extensions: core.extensions(),
      modelLists: core.modelLists(),
      setups: core.setups(),
      groups: core.groups(),
      memory: core.memory(),
      workers: core.workers(),
      engineTools: core.engineTools(),
      corePrompts: core.corePrompts(),
      workFolder: core.workFolder(),
      themes: core.themes(),
      installed: core.installed(),
      communityExtensions: core.communityExtensions(),
      restart: core.restart(),
    })
    socket.on('message', (data) => {
      try {
        core.handle(JSON.parse(String(data)), (message) => send(socket, message))
      } catch (error) {
        send(socket, { type: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    // ws re-emits the http server's errors on wss, where they'd go uncaught without a listener.
    wss.once('error', (error) => {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') return reject(error)
      reject(new Error(`Port ${port} is in use. Is Kothar already running? Set KOTHAR_PORT to use another port.`))
    })
    http.listen(port, '127.0.0.1', resolve)
  })

  const { port: boundPort } = http.address() as AddressInfo
  serveMcp = core.serveMcp(`http://127.0.0.1:${boundPort}/mcp`)
  return {
    port: boundPort,
    close: () =>
      new Promise<void>((resolve) => {
        wss.clients.forEach((socket) => socket.terminate())
        wss.close()
        http.closeAllConnections()
        http.close(() => resolve())
      }),
  }
}
