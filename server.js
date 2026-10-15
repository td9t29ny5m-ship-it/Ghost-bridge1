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
const { Authflow, Titles } = require('prismarine-auth')
const { createGhost } = require('./ghost')

const WEB_PORT = +process.env.PORT || 3000
const RELAY_PORT = +process.env.RELAY_PORT || 19134
const PUBLIC_PORT = +process.env.PUBLIC_PORT || RELAY_PORT // the port players use from outside (differs when you use a tunnel)
const DATA = path.join(__dirname, 'data')
const SCHEM_DIR = path.join(__dirname, 'schematics')
for (const d of [DATA, SCHEM_DIR, path.join(DATA, 'profiles'), path.join(DATA, 'host-auth')]) fs.mkdirSync(d, { recursive: true })

let ADMIN = process.env.ADMIN_PASSWORD
if (!ADMIN) { ADMIN = crypto.randomBytes(5).toString('hex'); console.log(`\n  No ADMIN_PASSWORD set. Temporary password: ${ADMIN}\n`) }

// ---------- state shown on the website ----------
const H = { status: 'signed_out', code: null, uri: null, gamertag: null, error: null } // Xbox host account
const B = { status: 'stopped', host: null, port: null, since: null, error: null, portal: 'off', portalError: null, publicHost: null, publicPort: PUBLIC_PORT, inviteGamertag: null, inviteStatus: 'not_requested', inviteError: null }
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
  if (portalRetryTimer) { clearTimeout(portalRetryTimer); portalRetryTimer = null }
  try { if (portal) await portal.end() } catch {}
  try { if (relay) relay.close() } catch {}
  portal = null; relay = null; ghost = null; playerCode = null
  pendingInviteGamertag = null
  Object.assign(B, { status: 'stopped', host: null, port: null, since: null, error: null, portal: 'off', portalError: null, inviteGamertag: null, inviteStatus: 'not_requested', inviteError: null })
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
    const redirectTarget = await dns.promises.lookup(B.host, { family: 4 })
    addLog('Resolved redirect target ' + B.host + ' to IPv4 ' + redirectTarget.address)
    const nextPortal = new BedrockPortal({
      ip: redirectTarget.address, port: B.port, joinability: Joinability.FriendsOfFriends, host: getAuthflow(),
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
    addLog('Friends-list world is live and redirects directly to ' + B.host + ':' + B.port + ' (bypasses relay; compatible with hosts without public UDP)')
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
      profilesFolder: path.join(DATA, 'profiles'), motd: { motd: 'Ghost Proxy', levelName: host },
      onMsaCode: (code, ds) => { // first join: the player signs in once so the server sees their own account
        playerCode = { code: code.user_code, uri: code.verification_uri, at: Date.now() }
        addLog(`Player sign-in needed: ${code.user_code}`)
        ds.disconnect("First time here! Sign in at microsoft.com/link with code " + code.user_code + ", then rejoin.")
      }
    })
    ghost.attach(relay)
    relay.on('join', ds => { playerCode = null; addLog(`${(ds.profile && ds.profile.name) || 'A player'} joined ${host}:${port}`) })
    relay.on('error', e => addLog('Relay error: ' + (e && e.message)))
    await Promise.resolve(relay.listen())
    B.status = 'running'; B.since = Date.now()
    addLog(`Relay up on UDP ${RELAY_PORT} -> ${host}:${port} (Minecraft ${ghost.version})`)
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
app.use(express.static(path.join(__dirname, 'public')))

const FILE_RE = /^[\w .()-]{1,80}\.(litematic|schem|schematic|nbt|mcstructure)$/i
const localIps = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address)
const list = () => fs.readdirSync(SCHEM_DIR).filter(f => FILE_RE.test(f)).map(f => ({ name: f, size: fs.statSync(path.join(SCHEM_DIR, f)).size }))

app.get('/api/state', auth, (req, res) => {
  const cur = ghost && ghost.current()
  res.json({ host: H, bridge: B, relayPort: RELAY_PORT, localIps, version: ghost ? ghost.version : require('./ghost').defaultVersion(), playerCode,
    player: cur ? cur.status() : null, files: list(), feed: feed.slice(-30), logs: logs.slice(-40) })
})
app.post('/api/host/login', auth, (req, res) => { hostLogin(); res.json({ ok: true }) })
app.post('/api/connect', auth, express.json(), async (req, res) => {
  const host = String((req.body && req.body.host) || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const port = parseInt((req.body && req.body.port) || 19132, 10)
  try { await checkDest(host, port) } catch (e) { return res.status(400).json({ error: e.message }) }
  const inviteGamertag = String((req.body && req.body.inviteGamertag) || '').trim()
  if (inviteGamertag.length > 64 || /[\u0000-\u001f]/.test(inviteGamertag)) return res.status(400).json({ error: 'Enter a valid Xbox gamertag.' })
  startBridge(host, port, req, inviteGamertag || null) // invite is sent after the portal comes online
  res.json({ ok: true })
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
  fs.writeFileSync(path.join(SCHEM_DIR, name), req.body); res.json({ files: list() })
})
app.delete('/api/schematics/:name', auth, (req, res) => {
  const name = path.basename(req.params.name)
  if (FILE_RE.test(name)) fs.rmSync(path.join(SCHEM_DIR, name), { force: true })
  res.json({ files: list() })
})

app.listen(WEB_PORT, () => console.log(`Ghost Bridge website on http://0.0.0.0:${WEB_PORT}  (relay UDP port ${RELAY_PORT})`))
process.on('SIGINT', async () => { await stopBridge(); process.exit(0) })