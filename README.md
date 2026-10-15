# Ghost Bridge

A mobile-first dashboard for a Minecraft Bedrock relay and Friends-session redirect.

## Deploy

- Node.js 20 or newer.
- Install dependencies with `npm install`.
- Start with `npm start`.
- Set `ADMIN_PASSWORD` in the hosting environment.
- Web dashboard listens on `PORT` (default 3000); Bedrock relay uses UDP `RELAY_PORT` (default 19134).
- The destination server must be reachable from the host.

## Connection behaviour

- The dashboard polls status automatically and offers a one-tap reconnect action.
- If cached Xbox host sign-in finishes after the relay starts, the Friends portal starts automatically.
- If Friends-session startup fails, the server logs the reason and retries after 20 seconds while the bridge and host account remain active.
- The Xbox Friends session is active only when the bridge is started and the portal reports `on`. A signed-in account alone is not a live joinable session.
- Friend request handling only works while the portal is running.

## Important limitations

- A free hosting instance can sleep or restart. Retry logic can recover from portal errors while the process is alive, but cannot keep a sleeping/stopped hosting instance awake. For genuine 24/7 availability, use an always-on service and persistent authentication storage.
- The current `ghost.js` engine is a scaffold. Automated schematic building, layer controls, and in-game command forwarding are not implemented yet. The dashboard no longer presents those as working controls.
- Use a separate Xbox account for the portal. This project is not affiliated with Microsoft or Mojang.
