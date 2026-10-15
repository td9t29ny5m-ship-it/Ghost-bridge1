# Ghost Bridge

Mobile-friendly web dashboard and Minecraft Bedrock relay.

## Run
- Node.js 20 or newer is required.
- Install dependencies with `npm install`.
- Start with `npm start`.
- Set `ADMIN_PASSWORD` to a password before deploying.
- The website listens on `PORT` (default 3000).
- The Bedrock relay listens on UDP `RELAY_PORT` (default 19134). Your host must support public UDP traffic for console connections.

## Important
The current `ghost.js` is a scaffold. Schematic rendering and in-game command forwarding are not implemented yet. Hosting this repository alone does not make those features functional.
