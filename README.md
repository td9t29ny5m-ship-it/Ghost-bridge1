# Ghost Bridge

Mobile-first dashboard for a Minecraft Bedrock relay and a Friends-session redirect.

## Runtime

- Node.js 24 or newer (required by the current `bedrock-protocol` dependency).
- Install dependencies with `npm install`; start with `npm start`.
- The web dashboard listens on `PORT` (fallback `WEB_PORT`, then 3000).
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
