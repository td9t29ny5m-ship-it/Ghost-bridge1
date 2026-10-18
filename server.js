// Ghost Bridge: a small website (mobile friendly) that runs the ghost proxy for you.
// You enter a server IP/port, and a world named "Ghost Proxy" appears in your console's Friends list.
const express = require('express')
const crypto = require('crypto')
const dns = require('dns')
const net = require('net')
const os = require('os')
const fs = require('fs')
const path = require('path')
const bedrock = require('bedrock-protocol')
const { Schematic } = require('prismarine-schematic')
const nbt = require('prismarine-nbt')
const { Vec3 } = require('vec3')
const { Authflow, Titles } = require('prismarine-auth')
const { createGhost } = require('./ghost')

const WEB_PORT = Number(process.env.SERVER_PORT || process.env.PORT || process.env.WEB_PORT || 12019)
const RELAY_PORT = +process.env.RELAY_PORT || +process.env.GAME_PORT || +process.env.SERVER_PORT || 19134
const RELAY_PUBLIC_HOST = String(process.env.RELAY_PUBLIC_HOST || '').trim() || null
const RELAY_PUBLIC_PORT = +process.env.RELAY_PUBLIC_PORT || +process.env.PUBLIC_PORT || RELAY_PORT // public UDP endpoint forwarded to RELAY_PORT
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'))
const SCHEM_DIR = path.join(DATA, 'schematics')
const PACK_DIR = path.join(DATA, 'resource-packs')
const ADDON_DIR = path.join(DATA, 'addons')
for (const d of [DATA, SCHEM_DIR, PACK_DIR, ADDON_DIR, path.join(DATA, 'profiles'), path.join(DATA, 'host-auth')]) fs.mkdirSync(d, { recursive: true })

let ADMIN = process.env.ADMIN_PASSWORD
if (!ADMIN) { ADMIN = crypto.randomBytes(5).toString('hex'); console.log(`\n  No ADMIN_PASSWORD set. Temporary password: ${ADMIN}\n`) }

// ---------- state shown on the website ----------
const H = { status: 'signed_out', code: null, uri: null, gamertag: null, error: null } // Xbox host account
const B = { status: 'stopped', host: null, port: null, since: null, error: null, portal: 'off', portalError: null, portalMode: null, publicHost: null, publicPort: RELAY_PUBLIC_PORT, inviteGamertag: null, inviteStatus: 'not_requested', inviteError: null,
  packExchange: { status: 'waiting_for_connection', serverPackCount: null, packetsSeen: 0, lastPacket: null, lastUpdated: null, note: 'Diagnostics only: custom-pack substitution is not implemented yet.' } }
// Bedrock relay batching defaults to 20 ms; a shorter flush target can reduce proxy-added wait.
const BATCHING_INTERVAL_MS = Math.min(20, Math.max(1, Number(process.env.RELAY_BATCHING_INTERVAL_MS) || 5))
const network = { status: 'idle', latencyMs: null, minMs: null, avgMs: null, maxMs: null, samples: [], lastCheckedAt: null, error: null, serverVersion: null }
let pingTimer = null
let pingInProgress = false
const logs = []; const feed = []
let playerCode = null
const addLog = m => { logs.push({ t: Date.now(), m: String(m) }); if (logs.length > 200) logs.shift(); console.log('[bridge]', m) }
const addFeed = m => { feed.push({ t: Date.now(), m }); if (feed.length > 80) feed.shift() }

// ---------- Xbox host account (the account whose "world" shows up in your Friends list) ----------
let authflow = null
function getAuthflow () {
  if (!authflow) {
    authflow = new Authflow('host', path.join(DATA, 'host-auth'),
      { flow: 'live', authTitle: Titles.MinecraftNintendoSwitch, deviceType: 'Nintendo' },
      code => { H.status = 'signing_in'; H.code = code.user_code; H.uri = code.verification_uri; addLog('Xbox host sign-in code: ' + code.user_code) })
  }
  return authflow
}
async function fetchGamertag (x) {
  const r = await fetch('https://profile.xboxlive.com/users/me/profile/settings?settings=Gamertag', {
    headers: { Authorization: `XBL3.0 x=${x.userHash};${x.XSTSToken}`, 'x-xbl-contract-version': '3', Accept: 'application/json' }
  })
  const j = await r.json()
  return j.profileUsers[0].settings[0].value
}
let hostLoginRunning = false
async function hostLogin () {
  if (hostLoginRunning) return
  hostLoginRunning = true; H.status = 'signing_in'; H.error = null
  try {
    const x = await getAuthflow().getXboxToken()
    H.status = 'ready'; H.code = null; H.uri = null
    H.gamertag = await fetchGamertag(x).catch(() => null)
    addLog('Xbox host account signed in' + (H.gamertag ? ': ' + H.gamertag : ''))
    if (B.status === 'running' && B.portal !== 'on') startPortal({ hostname: lastRequestHost }).catch(e => addLog('Portal recovery failed: ' + e.message))
  } catch (e) { H.status = 'error'; H.error = e.message; addLog('Host sign-in failed: ' + e.message) }
  hostLoginRunning = false
}
if (fs.readdirSync(path.join(DATA, 'host-auth')).length) hostLogin() // cached tokens: sign in silently

// ---------- destination safety (don't let this become an open proxy into private networks) ----------
const PRIVATE = new net.BlockList()
for (const [a, p] of [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['127.0.0.0', 8], ['169.254.0.0', 16], ['100.64.0.0', 10], ['0.0.0.0', 8]]) PRIVATE.addSubnet(a, p, 'ipv4')
PRIVATE.addSubnet('fc00::', 7, 'ipv6'); PRIVATE.addSubnet('fe80::', 10, 'ipv6'); PRIVATE.addAddress('::1', 'ipv6')
async function checkDest (host, port) {
  if (!/^[a-z0-9.-]{1,253}$/i.test(host)) throw new Error('That does not look like a valid server address.')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535.')
  const addrs = await dns.promises.lookup(host, { all: true }).catch(() => { throw new Error("Couldn't find that server address.") })
  if (!process.env.ALLOW_PRIVATE && addrs.some(a => PRIVATE.check(a.address, a.family === 6 ? 'ipv6' : 'ipv4'))) throw new Error('Private/local addresses are blocked (set ALLOW_PRIVATE=1 to allow).')
}
async function detectPublicHost (req) {
  if (process.env.PUBLIC_HOST) return process.env.PUBLIC_HOST
  try { const r = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(4000) }); const t = (await r.text()).trim(); if (net.isIP(t)) return t } catch {}
  return req.hostname
}

// ---------- the bridge: relay + Friends-list session ----------
let ghost = null; let relay = null; let portal = null
let portalRetryTimer = null
let portalStartRunning = false
let lastRequestHost = 'localhost'
let pendingInviteGamertag = null
async function stopBridge () {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
  Object.assign(network, { status: 'idle', latencyMs: null, minMs: null, avgMs: null, maxMs: null, samples: [], lastCheckedAt: null, error: null, serverVersion: null })
  if (portalRetryTimer) { clearTimeout(portalRetryTimer); portalRetryTimer = null }
  try { if (portal) await portal.end() } catch {}
  try { if (relay) relay.close() } catch {}
  portal = null; relay = null; ghost = null; playerCode = null
  B.packExchange = { status: 'waiting_for_connection', serverPackCount: null, packetsSeen: 0, lastPacket: null, lastUpdated: null, note: 'Diagnostics only: custom-pack substitution is not implemented yet.' }
  pendingInviteGamertag = null
  Object.assign(B, { status: 'stopped', host: null, port: null, since: null, error: null, portal: 'off', portalError: null, portalMode: null, inviteGamertag: null, inviteStatus: 'not_requested', inviteError: null })
}
async function startPortal (req = { hostname: lastRequestHost }) {
  if (portalStartRunning || B.status !== 'running') return
  if (portalRetryTimer) { clearTimeout(portalRetryTimer); portalRetryTimer = null }
  portalStartRunning = true
  try {
    if (H.status !== 'ready') {
      B.portal = 'off'
      addLog('Friends session waiting for host sign-in. It will start automatically after sign-in completes.')
      return
    }
    B.publicHost = B.publicHost || await detectPublicHost(req || { hostname: lastRequestHost })
    B.portal = 'starting'
    B.portalError = null
    try { if (portal) await portal.end() } catch {}
    portal = null
    const { BedrockPortal, Joinability, Modules } = require('bedrock-portal')
    // Prefer the public UDP relay when configured. If the host only exposes the website,
    // still start the Friends session and send the invite via a direct destination fallback.
    // Direct mode makes joining possible, but Bedrock traffic bypasses the relay and its preview features.
    const usingPublicRelay = Boolean(RELAY_PUBLIC_HOST)
    const redirectHost = usingPublicRelay ? RELAY_PUBLIC_HOST : B.host
    const redirectPort = usingPublicRelay ? RELAY_PUBLIC_PORT : B.port
    B.portalMode = usingPublicRelay ? 'relay' : 'direct'
    if (!usingPublicRelay) addLog('No public UDP relay configured: starting Friends session in direct-join fallback mode. Invites can work, but relay-based schematic features are bypassed.')
    const redirectTarget = await dns.promises.lookup(redirectHost, { family: 4 })
    addLog('Resolved redirect target ' + redirectHost + ' to IPv4 ' + redirectTarget.address + ':' + redirectPort)
    const nextPortal = new BedrockPortal({
      ip: redirectTarget.address, port: redirectPort, joinability: Joinability.FriendsOfFriends, host: getAuthflow(),
      world: { hostName: 'Ghost Proxy', name: B.host || 'Bedrock Server', version: ghost.version, memberCount: 1, maxMemberCount: 10 }
    })
    nextPortal.use(Modules.AutoFriendAdd, { inviteOnAdd: true })
    nextPortal.use(Modules.AutoFriendAccept, { inviteOnAdd: true })
    portal = nextPortal
    await nextPortal.start()
    if (B.status !== 'running') {
      try { await nextPortal.end() } catch {}
      if (portal === nextPortal) portal = null
      return
    }
    B.portal = 'on'
    addLog(usingPublicRelay ? ('Friends-list world redirects through public relay ' + RELAY_PUBLIC_HOST + ':' + RELAY_PUBLIC_PORT) : ('Friends-list world redirects directly to ' + B.host + ':' + B.port + ' (relay bypass mode; portal invite is available, but schematic interception is not)'))
    if (pendingInviteGamertag && B.inviteStatus !== 'sent') {
      B.inviteStatus = 'sending'; B.inviteError = null
      try {
        const profile = await nextPortal.host.rest.getProfile(pendingInviteGamertag)
        try {
          await nextPortal.host.rest.addXboxFriend(profile.xuid)
          addLog('Added ' + pendingInviteGamertag + ' as an Xbox friend')
        } catch (friendErr) {
          // They may already be a friend. Still try to invite them.
          addLog('Xbox friend-add response for ' + pendingInviteGamertag + ': ' + friendErr.message + ' (continuing to invite)')
        }
        await nextPortal.invitePlayer(profile.xuid)
        B.inviteStatus = 'sent'
        addLog('Game invite sent to ' + pendingInviteGamertag)
      } catch (inviteErr) {
        B.inviteStatus = 'error'; B.inviteError = inviteErr.message
        addLog('Could not add/invite ' + pendingInviteGamertag + ': ' + inviteErr.message)
      }
    }
  } catch (e) {
    B.portal = 'error'
    B.portalError = e.message
    addLog('Friends-list session failed: ' + e.message)
    if (B.status === 'running' && H.status === 'ready' && !portalRetryTimer) {
      addLog('Will retry the Friends session automatically in 20 seconds.')
      portalRetryTimer = setTimeout(() => {
        portalRetryTimer = null
        startPortal({ hostname: lastRequestHost }).catch(err => addLog('Portal retry failed: ' + err.message))
      }, 20000)
      if (portalRetryTimer && typeof portalRetryTimer.unref === 'function') portalRetryTimer.unref()
    }
  } finally {
    portalStartRunning = false
  }
}
async function sampleNetwork () {
  if (pingInProgress || B.status !== 'running' || !B.host || !B.port) return
  pingInProgress = true
  if (!network.samples.length) network.status = 'checking'
  const started = Date.now()
  try {
    const pong = await bedrock.ping({ host: B.host, port: B.port, timeout: 1800 })
    const ms = Math.max(0, Date.now() - started)
    network.samples.push(ms)
    if (network.samples.length > 10) network.samples.shift()
    network.latencyMs = ms
    network.minMs = Math.min(...network.samples)
    network.maxMs = Math.max(...network.samples)
    network.avgMs = Math.round(network.samples.reduce((sum, n) => sum + n, 0) / network.samples.length)
    network.status = 'ok'
    network.error = null
    network.serverVersion = pong && (pong.version || pong.gameVersion) || null
  } catch (e) {
    const firstFailure = network.status !== 'warning'
    network.status = 'warning'
    network.latencyMs = null
    network.error = String(e && e.message || e).slice(0, 180)
    if (firstFailure) addLog('Server ping probe failed (the game connection may still work): ' + network.error)
  } finally {
    network.lastCheckedAt = Date.now()
    pingInProgress = false
  }
}
function startNetworkMonitor () {
  if (pingTimer) clearInterval(pingTimer)
  Object.assign(network, { status: 'checking', latencyMs: null, minMs: null, avgMs: null, maxMs: null, samples: [], lastCheckedAt: null, error: null, serverVersion: null })
  sampleNetwork().catch(e => addLog('Network monitor error: ' + e.message))
  pingTimer = setInterval(() => sampleNetwork().catch(e => addLog('Network monitor error: ' + e.message)), 15000)
  if (pingTimer && typeof pingTimer.unref === 'function') pingTimer.unref()
}

async function startBridge (host, port, req, inviteGamertag = null) {
  await checkDest(host, port)
  lastRequestHost = (req && req.hostname) || lastRequestHost
  await stopBridge()
  B.status = 'starting'; B.host = host; B.port = port; B.error = null
  pendingInviteGamertag = inviteGamertag || null
  B.inviteGamertag = pendingInviteGamertag
  B.inviteStatus = pendingInviteGamertag ? 'waiting_for_portal' : 'not_requested'
  B.inviteError = null
  try {
    ghost = createGhost({ stateKey: `${host}:${port}`, schemDir: SCHEM_DIR, stateFile: path.join(DATA, 'state.json'), onSay: addFeed, log: addLog })
    relay = new bedrock.Relay({
      version: ghost.version, host: '0.0.0.0', port: RELAY_PORT, destination: { host, port },
      batchingInterval: BATCHING_INTERVAL_MS,
      profilesFolder: path.join(DATA, 'profiles'), motd: { motd: 'Ghost Proxy', levelName: host },
      onMsaCode: (code, ds) => { // first join: the player signs in once so the server sees their own account
        playerCode = { code: code.user_code, uri: code.verification_uri, at: Date.now() }
        addLog(`Player sign-in needed: ${code.user_code}`)
        ds.disconnect("First time here! Sign in at microsoft.com/link with code " + code.user_code + ", then rejoin.")
      }
    })
    // Observe the native Bedrock resource-pack handshake without changing or logging pack bytes,
    // hashes, content keys, authentication data, or signed URLs. This confirms whether the
    // destination offers packs and whether the console completes the ordinary exchange.
    relay.on('connect', player => {
      player.on('clientbound', ({ name, params }) => {
        if (!name || !name.startsWith('resource_pack_')) return
        const state = B.packExchange
        state.packetsSeen++
        state.lastPacket = 'server→console: ' + name
        state.lastUpdated = Date.now()
        if (name === 'resource_packs_info') {
          const packs = params && (params.resource_packs || params.texture_packs)
          state.serverPackCount = Array.isArray(packs) ? packs.length : null
          state.status = state.serverPackCount > 0 ? 'server_packs_detected' : 'server_pack_info_received'
          addLog('Pack diagnostics: destination sent resource_packs_info' +
            (state.serverPackCount === null ? ' (pack count unavailable in this protocol schema)' : ' (' + state.serverPackCount + ' pack(s))'))
        } else if (name === 'resource_pack_stack') {
          state.status = 'server_pack_stack_received'
          addLog('Pack diagnostics: destination sent resource_pack_stack; forwarding unchanged')
        }
      })
      player.on('serverbound', ({ name, params }) => {
        if (name !== 'resource_pack_client_response') return
        const state = B.packExchange
        state.packetsSeen++
        state.lastPacket = 'console→server: ' + name
        state.lastUpdated = Date.now()
        const response = params && (params.response || params.status)
        if (response !== undefined) state.status = 'console_pack_response_' + String(response)
        addLog('Pack diagnostics: console responded to resource-pack exchange (response value ' +
          (response === undefined ? 'unavailable' : String(response)) + '); forwarded unchanged')
      })
    })
    ghost.attach(relay)
    relay.on('join', ds => { playerCode = null; addLog(`${(ds.profile && ds.profile.name) || 'A player'} joined ${host}:${port}`) })
    relay.on('error', e => addLog('Relay error: ' + (e && e.message)))
    await Promise.resolve(relay.listen())
    B.status = 'running'; B.since = Date.now()
    addLog(`Relay up on UDP ${RELAY_PORT} -> ${host}:${port} (Minecraft ${ghost.version}; packet batching ${BATCHING_INTERVAL_MS} ms)`)
    startNetworkMonitor()
  } catch (e) { B.status = 'error'; B.error = e.message; addLog('Relay failed: ' + e.message); return }

  await startPortal(req)
}

// ---------- web server ----------
const app = express()
app.disable('x-powered-by')
const tokens = new Set(); const attempts = new Map()
app.post('/api/login', express.json(), (req, res) => {
  const ip = req.ip; const a = attempts.get(ip) || { n: 0, until: 0 }
  if (Date.now() < a.until) return res.status(429).json({ error: 'Too many tries. Wait a minute.' })
  const given = Buffer.from(String((req.body && req.body.password) || '')); const real = Buffer.from(ADMIN)
  const ok = given.length === real.length && crypto.timingSafeEqual(given, real)
  if (!ok) { a.n++; if (a.n >= 5) { a.n = 0; a.until = Date.now() + 60000 } attempts.set(ip, a); return res.status(401).json({ error: 'Wrong password.' }) }
  attempts.delete(ip)
  const t = crypto.randomBytes(24).toString('hex'); tokens.add(t); res.json({ token: t })
})
const auth = (req, res, next) => {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '')
  return tokens.has(t) ? next() : res.status(401).json({ error: 'Not signed in.' })
}
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true, service: 'ghost-bridge', uptimeSeconds: Math.floor(process.uptime()) }))
app.use(express.static(path.join(__dirname, 'public')))

const FILE_RE = /^[\w .()-]{1,80}\.(litematic|schem|schematic|nbt|mcstructure)$/i
const PACK_RE = /^[\w .()-]{1,80}\.(mcpack|zip)$/i
const ADDON_RE = /^[\w .()-]{1,80}\.(mcaddon|mcpack|zip)$/i
const localIps = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address)
const listDir = (dir, re) => fs.readdirSync(dir).filter(f => re.test(f)).map(f => ({ name: f, size: fs.statSync(path.join(dir, f)).size }))
const list = () => listDir(SCHEM_DIR, FILE_RE)
const listPacks = () => listDir(PACK_DIR, PACK_RE)
const listAddons = () => listDir(ADDON_DIR, ADDON_RE)

app.get('/api/state', auth, (req, res) => {
  const cur = ghost && ghost.current()
  res.json({ host: H, bridge: B, relayPort: RELAY_PORT, batchingIntervalMs: BATCHING_INTERVAL_MS, network, localIps, version: ghost ? ghost.version : require('./ghost').defaultVersion(), playerCode,
    player: cur ? cur.status() : null, files: list(), resourcePacks: listPacks(), addons: listAddons(), feed: feed.slice(-30), logs: logs.slice(-40) })
})
app.post('/api/host/login', auth, (req, res) => { hostLogin(); res.json({ ok: true }) })
app.post('/api/connect', auth, express.json(), async (req, res) => {
  let host = String((req.body && req.body.host) || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  // Prefer the Bedrock-specific endpoint when the common DonutSMP hostname is entered.
  if (/^(?:www\.)?donutsmp\.net$/i.test(host)) {
    host = 'bedrock.donutsmp.net'
    addLog('Using DonutSMP Bedrock endpoint: ' + host)
  }
  const port = parseInt((req.body && req.body.port) || 19132, 10)
  try { await checkDest(host, port) } catch (e) { return res.status(400).json({ error: e.message }) }
  const inviteGamertag = String((req.body && req.body.inviteGamertag) || '').trim()
  if (inviteGamertag.length > 64 || /[\u0000-\u001f]/.test(inviteGamertag)) return res.status(400).json({ error: 'Enter a valid Xbox gamertag.' })
  try {
    await startBridge(host, port, req, inviteGamertag || null) // Wait for startup checks before reporting success.
  } catch (e) {
    addLog('Connect request failed: ' + e.message)
    return res.status(400).json({ error: e.message })
  }
  if (B.status === 'error' || B.portal === 'error') return res.status(502).json({ error: B.error || B.portalError || 'The Bedrock portal failed to start.' })
  res.json({ ok: true, status: B.status, portal: B.portal, host: B.host, port: B.port })
})
app.post('/api/disconnect', auth, async (req, res) => { await stopBridge(); res.json({ ok: true }) })
app.post('/api/command', auth, express.json(), async (req, res) => {
  const text = String((req.body && req.body.text) || '').slice(0, 200)
  const cur = ghost && ghost.current()
  if (!cur) return res.status(409).json({ error: 'No player connected yet. Join the world from your console first.' })
  try { await cur.run(text); res.json({ ok: true }) } catch (e) { res.status(500).json({ error: e.message }) }
})
app.put('/api/schematics/:name', auth, express.raw({ type: () => true, limit: '60mb' }), (req, res) => {
  const name = path.basename(req.params.name)
  if (!FILE_RE.test(name)) return res.status(400).json({ error: 'Use a .litematic, .schem, .schematic, .nbt or .mcstructure file (simple file name).' })
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Empty upload.' })
  fs.writeFileSync(path.join(SCHEM_DIR, name), req.body); schematicViewerCache.delete(name); res.json({ files: list() })
})
app.delete('/api/schematics/:name', auth, (req, res) => {
  const name = path.basename(req.params.name)
  if (FILE_RE.test(name)) { fs.rmSync(path.join(SCHEM_DIR, name), { force: true }); schematicViewerCache.delete(name) }
  res.json({ files: list() })
})

// Browser schematic workbench: parse supported Sponge/legacy schematics on demand.
// The viewer is a guide only; these coordinates are never sent to the Minecraft server.
function nbtNumber(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && value.value !== undefined) return nbtNumber(value.value)
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error('Invalid numeric value in structure NBT.')
  return Math.trunc(n)
}
function nbtArray(value) {
  if (Array.isArray(value)) return value
  if (value && Array.isArray(value.value)) return value.value
  return []
}
function nbtName(value) {
  if (typeof value === 'string') return value.replace(/^minecraft:/, '')
  if (value && typeof value === 'object') return nbtName(value.value)
  return ''
}
async function readSchematicNbt(filePath, format = 'big') {
  const buffer = await fs.promises.readFile(filePath)
  const parsed = await new Promise((resolve, reject) => nbt.parse(buffer, format, (err, data) => err ? reject(err) : resolve(data)))
  return nbt.simplify(parsed)
}
function gridSchematic(size, blockMap) {
  const dimensions = new Vec3(size.x, size.y, size.z)
  const start = new Vec3(0, 0, 0)
  const end = new Vec3(size.x - 1, size.y - 1, size.z - 1)
  return {
    size: dimensions,
    start: () => start,
    end: () => end,
    getBlock: pos => ({ name: blockMap.get(`${pos.x},${pos.y},${pos.z}`) || 'air' })
  }
}
function addSolid(map, x, y, z, name) {
  name = nbtName(name)
  if (!name || ['air', 'cave_air', 'void_air', 'structure_void'].includes(name)) return
  map.set(`${x},${y},${z}`, name)
}
function parseLitematic(root) {
  const regions = root && root.Regions
  if (!regions || typeof regions !== 'object') throw new Error('This .litematic file has no Regions data.')
  const worldBlocks = []
  let min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity }
  let visited = 0
  for (const region of Object.values(regions)) {
    if (!region || !region.Size || !region.Position) continue
    const signed = { x: nbtNumber(region.Size.x), y: nbtNumber(region.Size.y), z: nbtNumber(region.Size.z) }
    const size = { x: Math.abs(signed.x), y: Math.abs(signed.y), z: Math.abs(signed.z) }
    const pos = { x: nbtNumber(region.Position.x), y: nbtNumber(region.Position.y), z: nbtNumber(region.Position.z) }
    const volume = size.x * size.y * size.z
    visited += volume
    if (!size.x || !size.y || !size.z || visited > 100000) throw new Error('This Litematica build exceeds the 100,000-block viewer safety limit.')
    const palette = nbtArray(region.BlockStatePalette)
    const states = nbtArray(region.BlockStates)
    if (!palette.length) continue
    const bits = Math.max(2, Math.ceil(Math.log2(palette.length)))
    const perLong = Math.floor(64 / bits)
    const mask = (1n << BigInt(bits)) - 1n
    const longs = states.map(v => {
      if (typeof v === 'bigint') return BigInt.asUintN(64, v)
      if (typeof v === 'object' && v && v.value !== undefined) v = v.value
      try { return BigInt.asUintN(64, BigInt(v)) } catch { return 0n }
    })
    // Litematica files from different Minecraft generations may use either
    // padded values-per-long storage or a continuous bit stream. Pick the
    // layout whose exact long-array length matches the region volume.
    const paddedLongCount = Math.ceil(volume / perLong)
    const continuousLongCount = Math.ceil((volume * bits) / 64)
    const packedLayout = continuousLongCount !== paddedLongCount && longs.length === continuousLongCount
      ? 'continuous'
      : 'padded'
    const paletteIndexAt = index => {
      let value
      if (packedLayout === 'continuous') {
        const bitIndex = index * bits
        const longIndex = Math.floor(bitIndex / 64)
        const offset = bitIndex % 64
        if (longIndex >= longs.length) return 0
        value = longs[longIndex] >> BigInt(offset)
        if (offset + bits > 64 && longIndex + 1 < longs.length) {
          value |= longs[longIndex + 1] << BigInt(64 - offset)
        }
      } else {
        const longIndex = Math.floor(index / perLong)
        const offset = (index % perLong) * bits
        if (longIndex >= longs.length) return 0
        value = longs[longIndex] >> BigInt(offset)
      }
      const result = Number(value & mask)
      return result < palette.length ? result : 0
    }
    const bounds = axis => {
      const a = pos[axis], n = size[axis], signedN = signed[axis]
      return signedN < 0 ? [a - n + 1, a] : [a, a + n - 1]
    }
    for (const axis of ['x','y','z']) { const b = bounds(axis); min[axis] = Math.min(min[axis], b[0]); max[axis] = Math.max(max[axis], b[1]) }
    for (let y = 0; y < size.y; y++) for (let z = 0; z < size.z; z++) for (let x = 0; x < size.x; x++) {
      const index = (y * size.z + z) * size.x + x
      const paletteIndex = paletteIndexAt(index)
      const state = palette[paletteIndex]
      const name = state && (state.Name || state.name)
      if (!name) continue
      const world = { x: pos.x + (signed.x < 0 ? -x : x), y: pos.y + (signed.y < 0 ? -y : y), z: pos.z + (signed.z < 0 ? -z : z) }
      worldBlocks.push({ ...world, name })
    }
  }
  if (!worldBlocks.length || !Number.isFinite(min.x)) throw new Error('No block data was found in this Litematica file.')
  const size = { x: max.x-min.x+1, y: max.y-min.y+1, z: max.z-min.z+1 }
  if (size.x*size.y*size.z > 100000 || Math.max(size.x,size.y,size.z)>512) throw new Error('The combined Litematica regions exceed the viewer safety limit.')
  const map = new Map()
  for (const b of worldBlocks) addSolid(map,b.x-min.x,b.y-min.y,b.z-min.z,b.name)
  return gridSchematic(size,map)
}
function parseStructureNbt(root) {
  const sizeArray = nbtArray(root && root.size)
  const size = { x: nbtNumber(sizeArray[0]), y: nbtNumber(sizeArray[1]), z: nbtNumber(sizeArray[2]) }
  const volume = size.x*size.y*size.z
  if (!size.x || !size.y || !size.z || volume > 100000 || Math.max(size.x,size.y,size.z)>512) throw new Error('This structure exceeds the 100,000-block viewer safety limit.')
  const palette = nbtArray(root.palette || root.Palette)
  const blocks = nbtArray(root.blocks || root.Blocks)
  if (!palette.length || !blocks.length) throw new Error('This .nbt file is not a supported Minecraft structure file.')
  const map = new Map()
  for (const block of blocks) {
    const p = nbtArray(block.pos || block.Pos)
    const state = nbtNumber(block.state !== undefined ? block.state : block.State)
    if (p.length < 3 || !palette[state]) continue
    const x=nbtNumber(p[0]), y=nbtNumber(p[1]), z=nbtNumber(p[2])
    if (x<0||y<0||z<0||x>=size.x||y>=size.y||z>=size.z) continue
    const paletteEntry=palette[state]
    addSolid(map,x,y,z,paletteEntry.Name || paletteEntry.name)
  }
  return gridSchematic(size,map)
}
function parseMcstructure(root) {
  const structure = root && root.structure
  const sizeArray = nbtArray(root && root.size)
  const size = { x: nbtNumber(sizeArray[0]), y: nbtNumber(sizeArray[1]), z: nbtNumber(sizeArray[2]) }
  const volume = size.x*size.y*size.z
  if (!structure || !size.x || !size.y || !size.z || volume > 100000 || Math.max(size.x,size.y,size.z)>512) throw new Error('This .mcstructure file is invalid or exceeds the viewer safety limit.')
  const blockLayers = nbtArray(structure.block_indices)
  const palette = structure.palette && structure.palette.default && nbtArray(structure.palette.default.block_palette)
  if (!blockLayers.length || !palette || !palette.length) throw new Error('This .mcstructure file has no supported block palette.')
  const map = new Map()
  const indices = nbtArray(blockLayers[0])
  for (let index=0; index<Math.min(indices.length,volume); index++) {
    const paletteIndex=nbtNumber(indices[index])
    if (paletteIndex<0 || !palette[paletteIndex]) continue
    const x=index%size.x, z=Math.floor(index/size.x)%size.z, y=Math.floor(index/(size.x*size.z))
    addSolid(map,x,y,z,palette[paletteIndex].name || palette[paletteIndex].Name)
  }
  return gridSchematic(size,map)
}
const schematicViewerCache = new Map()
async function loadSchematicForViewer(name) {
  if (!/^[\w .()-]{1,80}\.(litematic|schem|schematic|nbt|mcstructure)$/i.test(name)) {
    throw new Error('Supported viewer formats: .litematic, .schem, .schematic, structure .nbt, and .mcstructure.')
  }
  const filePath = path.join(SCHEM_DIR, name)
  const stat = await fs.promises.stat(filePath).catch(() => null)
  if (!stat || !stat.isFile()) throw new Error('That schematic was not found. Upload it again and retry.')
  const cached = schematicViewerCache.get(name)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.sizeBytes === stat.size) return cached
  const extension = path.extname(name).toLowerCase()
  let schematic
  if (extension === '.schem' || extension === '.schematic') {
    schematic = await Schematic.read(await fs.promises.readFile(filePath))
  } else {
    const format = extension === '.mcstructure' ? 'little' : 'big'
    const root = await readSchematicNbt(filePath, format)
    if (extension === '.litematic') schematic = parseLitematic(root)
    else if (extension === '.mcstructure') schematic = parseMcstructure(root)
    else schematic = parseStructureNbt(root)
  }
  const size = schematic.size
  const start = schematic.start()
  const end = schematic.end()
  const volume = size && size.x * size.y * size.z
  if (!size || !Number.isFinite(volume) || volume < 1 || volume > 100000 || size.x > 512 || size.y > 512 || size.z > 512) {
    throw new Error('This schematic is empty or exceeds the viewer safety limit of 100,000 blocks or 512 blocks on any axis.')
  }
  const layerCounts = Array(size.y).fill(0)
  const paletteCounts = new Map()
  let blockCount = 0
  for (let y = start.y; y <= end.y; y++) {
    for (let z = start.z; z <= end.z; z++) {
      for (let x = start.x; x <= end.x; x++) {
        const block = schematic.getBlock(new Vec3(x, y, z))
        const blockName = String(block && block.name || '').replace(/^minecraft:/, '')
        if (!blockName || ['air', 'cave_air', 'void_air'].includes(blockName)) continue
        blockCount++
        layerCounts[y - start.y]++
        paletteCounts.set(blockName, (paletteCounts.get(blockName) || 0) + 1)
      }
    }
  }
  const metadata = {
    name, dimensions: { x: size.x, y: size.y, z: size.z },
    start: { x: start.x, y: start.y, z: start.z }, blockCount,
    layerCounts, palette: Array.from(paletteCounts, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 24)
  }
  const entry = { mtimeMs: stat.mtimeMs, sizeBytes: stat.size, schematic, metadata }
  schematicViewerCache.delete(name)
  schematicViewerCache.set(name, entry)
  while (schematicViewerCache.size > 3) schematicViewerCache.delete(schematicViewerCache.keys().next().value)
  return entry
}

app.get('/api/schematics/:name/preview', auth, async (req, res) => {
  const name = path.basename(req.params.name)
  if (name !== req.params.name || !FILE_RE.test(name)) return res.status(400).json({ error: 'Invalid schematic filename.' })
  try {
    const entry = await loadSchematicForViewer(name)
    if (req.query.layer === undefined && req.query.scene !== '1') return res.json(entry.metadata)
    if (req.query.scene === '1') {
      const { dimensions, start } = entry.metadata
      const end = entry.schematic.end()
      const blocks = []
      for (let y = start.y; y <= end.y; y++) {
        for (let z = start.z; z <= end.z; z++) {
          for (let x = start.x; x <= end.x; x++) {
            const block = entry.schematic.getBlock(new Vec3(x, y, z))
            const blockName = String(block && block.name || '').replace(/^minecraft:/, '')
            if (!blockName || ['air', 'cave_air', 'void_air'].includes(blockName)) continue
            if (blocks.length >= 30000) return res.status(413).json({ error: 'This 3D viewer is limited to 30,000 solid blocks for smooth mobile performance. The layer guide can still be used.' })
            blocks.push({ x: x - start.x, y: y - start.y, z: z - start.z, name: blockName })
          }
        }
      }
      return res.json({ name, dimensions, blockCount: blocks.length, blocks })
    }
    const layer = Number(req.query.layer)
    const { dimensions, start } = entry.metadata
    if (!Number.isInteger(layer) || layer < 0 || layer >= dimensions.y) return res.status(400).json({ error: 'Layer is outside this schematic.' })
    const y = start.y + layer
    const blocks = []
    const end = entry.schematic.end()
    for (let z = start.z; z <= end.z; z++) {
      for (let x = start.x; x <= end.x; x++) {
        const block = entry.schematic.getBlock(new Vec3(x, y, z))
        const blockName = String(block && block.name || '').replace(/^minecraft:/, '')
        if (!blockName || ['air', 'cave_air', 'void_air'].includes(blockName)) continue
        blocks.push({ x: x - start.x, z: z - start.z, name: blockName })
      }
    }
    res.json({ name, layer, dimensions, blockCount: blocks.length, blocks })
  } catch (e) {
    res.status(400).json({ error: 'Could not read schematic: ' + String(e.message || e).slice(0, 220) })
  }
})

function registerAssetRoutes(route, dir, re, label, listing) {
  app.put('/api/' + route + '/:name', auth, express.raw({ type: () => true, limit: '100mb' }), (req, res) => {
    const name = path.basename(req.params.name)
    if (!re.test(name)) return res.status(400).json({ error: 'Unsupported ' + label + ' file type.' })
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Empty upload.' })
    fs.writeFileSync(path.join(dir, name), req.body)
    res.json({ files: listing() })
  })
  app.delete('/api/' + route + '/:name', auth, (req, res) => {
    const name = path.basename(req.params.name)
    if (re.test(name)) fs.rmSync(path.join(dir, name), { force: true })
    res.json({ files: listing() })
  })
}
registerAssetRoutes('resource-packs', PACK_DIR, PACK_RE, 'resource-pack', listPacks)
registerAssetRoutes('addons', ADDON_DIR, ADDON_RE, 'add-on', listAddons)

const webServer = app.listen(WEB_PORT, '0.0.0.0', () => {
  console.log(`[wispbyte] Ghost Bridge HTTP listening on 0.0.0.0:${WEB_PORT}`)
  console.log(`[wispbyte] Bedrock relay UDP bind port: ${RELAY_PORT}`)
  console.log(`[wispbyte] Public UDP relay: ${RELAY_PUBLIC_HOST ? RELAY_PUBLIC_HOST + ':' + RELAY_PUBLIC_PORT : 'NOT CONFIGURED (web dashboard can work, console relay may not)'}`)
})
webServer.on('error', err => {
  console.error(`[wispbyte] HTTP listener failed on port ${WEB_PORT}: ${err.message}`)
  process.exitCode = 1
})
process.on('SIGTERM', async () => {
  try { await stopBridge() } catch (e) { console.error('[wispbyte] Shutdown error:', e.message) }
  webServer.close(() => process.exit(0))
})
process.on('SIGINT', async () => { await stopBridge(); process.exit(0) })
