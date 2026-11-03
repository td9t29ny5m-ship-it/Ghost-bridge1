# Ghost Stream

Ghost Stream is a private, mobile-friendly streaming management studio intended to be controlled from an iPhone browser. It replaces the previous Minecraft Bedrock bridge in this repository.

## Implemented in this version

- Password-protected single-owner dashboard (`ADMIN_PASSWORD`).
- Responsive overview, overlay studio, goals, alerts and settings pages.
- Multiple scenes with create, duplicate, switch and delete actions.
- Drag-to-position preview canvas with text, goal, clock and image-URL elements.
- Editable goal progress, alert styling and broadcast preferences.
- Browser-local autosave, JSON export/import and authenticated cloud-state sync.
- Health and status endpoints for deployment checks.
- No laptop-side process or OBS installation is required to use the management dashboard.

## Important streaming limitation

This version is a **stream management and overlay-design control plane**, not a cloud video relay. The PS5's built-in Twitch/YouTube broadcasting does not expose a general third-party video feed or an external overlay-injection endpoint. Therefore the studio can save and preview scenes, text, goals and alerts, but it cannot currently place those elements over the actual PS5 broadcast. The app intentionally reports video ingest, compositing and platform output as unavailable rather than pretending they work.

A true no-laptop live overlay pipeline needs a supported gameplay ingest source and a continuously running cloud video compositor with sufficient bandwidth. A normal Render web service alone is not that pipeline, and PS5 native broadcast cannot simply be redirected to an arbitrary Render URL.

## Deploy to Render

1. Create a **Web Service** from this GitHub repository.
2. Runtime: Node. Build command: `npm install`. Start command: `npm start`.
3. Set the environment variable `ADMIN_PASSWORD` to a strong private password.
4. Deploy. The health check is `GET /healthz`; the dashboard is served at `/`.

The `render.yaml` blueprint describes a free web service and prompts for `ADMIN_PASSWORD`.

## Data and privacy

The dashboard saves a copy in the current browser's `localStorage`, so scenes remain available on that device after a page reload. Authenticated cloud sync is also provided, but the current server-side state store is in memory. On a free Render service, cloud state can be lost when the service restarts or redeploys. Use **Export studio JSON** for a portable backup. Durable cross-device cloud storage needs a persistent database or storage service configured separately.

The password is supplied through Render environment variables and is never stored in the repository. Sessions use an HTTP-only, secure cookie.

## API

- `GET /healthz` - service health and capability flags.
- `GET /api/status` - authentication and integration status.
- `POST /api/login` - authenticate with `{ "password": "..." }`.
- `POST /api/logout` - end the session.
- `GET /api/state` - read the saved in-memory studio state (authenticated).
- `PUT /api/state` - save studio state (authenticated).

## Local run

Requires Node.js 20 or newer. Set `ADMIN_PASSWORD`, then run:

```sh
ADMIN_PASSWORD='choose-a-password' npm start
```

Open `http://localhost:10000`.
