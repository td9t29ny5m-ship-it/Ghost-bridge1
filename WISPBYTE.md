# Ghost Bridge on Wispbyte

## Start the website

1. Use a **Node.js** server/image. The project requires Node.js 24 or newer.
2. Make sure the repository files are in the server's working directory, including `server.js`, `ghost.js`, `package.json`, and the `public/` folder. Do not put the real project inside an extra nested folder unless your startup command points into it.
3. Install dependencies from `package.json`. If the panel has an Additional Node.js Packages field, use it only if Wispbyte has not already installed the package dependencies.
4. Set the startup command to `npm start` (or `node server.js`).
5. Start/restart the server and check Console. A successful web startup prints a line like `[wispbyte] Ghost Bridge HTTP listening on 0.0.0.0:12019`. The number should match the port assigned to your server/subdomain.
6. Open `https://GhostBridge.wispbyte.org/healthz`. A working website process returns JSON containing `"ok": true`. Then open the normal subdomain to use the dashboard.

The app now prefers Wispbyte's `SERVER_PORT`, then `PORT`, then `WEB_PORT`, and binds the HTTP listener to `0.0.0.0`. Do not set `PORT` to a different port from the one Wispbyte routes to your subdomain.

## Important: website vs. Minecraft relay

The dashboard uses **HTTP/TCP**. The Bedrock relay uses **UDP**. Getting the website to load does not prove the relay is reachable from a PS5. Wispbyte must give your server a publicly reachable UDP port and route that public port to the app's `RELAY_PORT`.

- `RELAY_PORT`: internal UDP port the Bedrock relay binds to. Defaults to `SERVER_PORT` when set, otherwise `19134`.
- `RELAY_PUBLIC_HOST`: public hostname/IP that console clients can reach for UDP traffic.
- `RELAY_PUBLIC_PORT`: public UDP port routed to `RELAY_PORT`; defaults to `RELAY_PORT`.
- `ADMIN_PASSWORD`: set a strong dashboard password in the Wispbyte environment variables. If omitted, the app generates a temporary password and prints it to Console on startup.
- `DATA_DIR`: optional writable persistent folder. Without persistent storage, uploads and Xbox login tokens may be lost after a restart/redeploy.

If Wispbyte only provides the HTTP subdomain and does not expose public UDP forwarding, the dashboard can run but the PS5 Friends-list relay cannot be made fully functional by changing JavaScript alone. Do not put the website's HTTP URL in `RELAY_PUBLIC_HOST`; it must be a UDP-reachable host.

## Quick diagnosis

- **Subdomain says no web server is running:** check Console for the exact port in the `[wispbyte] Ghost Bridge HTTP listening...` line. If there is no such line, check startup errors and dependency installation.
- **`Cannot find module 'express'`:** dependencies were not installed in the working directory. Install the dependencies listed in `package.json`, then restart.
- **Website works but Friends portal errors:** check Xbox sign-in and `RELAY_PUBLIC_HOST`; also confirm Wispbyte actually exposes public UDP.
- **Health check:** `/healthz` only checks the HTTP process, not UDP, Xbox login, or the in-game hologram.
