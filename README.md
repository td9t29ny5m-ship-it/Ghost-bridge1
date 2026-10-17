# Ghost Bridge

Mobile-first dashboard for a Minecraft Bedrock relay and a Friends-session redirect.

## Runtime

- Node.js 24 or newer (required by the current `bedrock-protocol` dependency).
- Install dependencies with `npm install`; start with `npm start`.
- The web dashboard listens on `PORT` (fallback `WEB_PORT`, then `SERVER_PORT`, then 3000). On a Pterodactyl-style host that assigns one public port, the web app and relay can use the same port number over TCP and UDP respectively, if the host exposes both protocols.
- The Bedrock relay listens on UDP `RELAY_PORT` (fallback `GAME_PORT`, then `SERVER_PORT`, then 19134). The hosting provider must expose this UDP port publicly.
- Set `RELAY_PUBLIC_HOST` to the public hostname/IP of a UDP endpoint that forwards to `RELAY_PORT`; set `RELAY_PUBLIC_PORT` (or `PUBLIC_PORT`) to its public UDP port. Without this endpoint, the Friends portal deliberately reports an error instead of silently bypassing the relay.
- Set `ADMIN_PASSWORD` to a strong dashboard password.
- Set `DATA_DIR` to a persistent writable volume if the host supports one. Schematics, uploaded resource packs/add-ons, and Xbox/auth profile data are stored beneath this directory. Without persistent storage, uploads and login tokens can be lost on restarts/redeploys.
- `GET /healthz` is a public health check for hosting providers.

## Important functional limits

- Uploading `.mcpack`/`.mcaddon` files stores them on the website; it does not install them on a PS5. Console resource-pack import must be validated separately.
- The current preview engine is experimental and is not yet proven against a live PS5/DonutSMP session. It currently supports `.schem` and `.schematic` for preview commands; accepting `.litematic`, `.nbt`, or `.mcstructure` in the upload list does not mean those formats are decoded by the preview engine.
- `/.build place` only locks the preview position; it does not place real blocks on the server.
- A successful HTTP deployment is not proof of UDP reachability, Xbox Friends-session compatibility, or correct Bedrock block runtime IDs. Test those separately before calling the project production-ready.
- Use a separate Xbox/Microsoft account for the portal. This project is not affiliated with Microsoft or Mojang.
## Wispbyte deployment

See [WISPBYTE.md](WISPBYTE.md) for the Wispbyte startup settings and the important difference between the website port (TCP) and the Minecraft relay port (UDP). The HTTP server binds explicitly to `0.0.0.0` and prioritizes Wispbyte's assigned `SERVER_PORT`.


## Schematic workbench

The dashboard includes an experimental browser-based schematic builder for `.schem` and legacy `.schematic` files:

- Interactive 3D model with orbit, pan, zoom, fit-to-model, and top/front/side camera presets.
- Full-build, current-layer, layers-up-to-current, and faded-lower-layer viewing modes.
- Procedural pixel-style block textures, a ground grid, and clickable block inspection with schematic-relative X/Y/Z coordinates.
- A 2D top-down layer blueprint, layer slider, previous/next controls, next unfinished layer, and per-layer completion tracking saved in the current browser.
- Full-build block counts, searchable material inventory, copyable material list, and CSV export.
- Mobile-friendly viewport and fullscreen where the browser supports it.

The 3D scene endpoint caps preview payloads at 30,000 solid blocks, and schematic dimensions are limited to 512 blocks per axis and 100,000 total volume to avoid exhausting small hosts or mobile browsers. Larger builds can still use the 2D layer guide when accepted by the parser. The textures are procedural approximations, not the official Minecraft resource-pack textures. The viewer is a companion guide only: it does not read a live PS5 world, detect placed blocks automatically, or draw an in-game hologram. The 3D renderer loads Three.js and OrbitControls from jsDelivr; if those scripts are unavailable, the 2D layer guide remains the fallback.
