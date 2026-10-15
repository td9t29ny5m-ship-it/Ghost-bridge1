# Ghost Bridge

A mobile-first dashboard for a Minecraft Bedrock relay and Friends-session redirect.

## Deploy

- Node.js 20 or newer.
- Install dependencies with `npm install`.
- Start with `npm start`.
- Set `ADMIN_PASSWORD` in the hosting environment.
- Web dashboard listens on `PORT` (default 3000); Bedrock relay uses UDP `RELAY_PORT` (default 19134).
- The destination server must be reachable from the host.

## Important limitations

- The Xbox Friends session is only active when the bridge is started and the portal reports `on`. A signed-in account alone is not a live joinable session.
- On-demand friend request handling only works while the portal is running.
- The current `ghost.js` engine is a scaffold. Automated schematic building, layer controls, and command forwarding are not implemented yet. The dashboard no longer presents those as working controls.
- A free hosting instance can sleep or restart. A web page redesign cannot guarantee 24/7 uptime; use an always-on service and implement persistent reconnection for that requirement.
- Use a separate Xbox account for the portal. This project is not affiliated with Microsoft or Mojang.
