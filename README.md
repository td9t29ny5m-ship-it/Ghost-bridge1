# Ghost Bridge

Ghost Bridge is a Node.js dashboard and experimental Minecraft Bedrock relay. It includes Xbox-host sign-in, a Friends-session portal, resource-pack/add-on file storage, a browser schematic viewer, and experimental client-side schematic preview commands.

## Quick start on Windows 11

**Requirements:** Windows 10/11 64-bit, Node.js 24 or newer, and an internet connection for the first package installation.

1. Install Node.js 24 or newer from [nodejs.org](https://nodejs.org/en/download). Choose the Windows x64 `.msi` installer. Keep the default installer options.
2. Download this repository using **Code → Download ZIP** on GitHub.
3. Extract the ZIP. Open the extracted folder that contains `package.json`.
4. Double-click `start-windows.bat`. The first run installs the Node.js packages. Leave its black terminal window open.
5. Open [http://localhost:3000](http://localhost:3000) in your browser. If you changed the `PORT` environment variable, use that port instead.
6. If you have not set `ADMIN_PASSWORD`, the app prints a temporary dashboard password in the terminal. Use that password on the login screen. Keep the terminal private.

If Windows blocks the batch file, you can run the same steps manually:

1. In the project folder, click File Explorer's address bar, type `cmd`, and press Enter.
2. Run:

   ```bat
   node -v
   npm -v
   npm install
   set PORT=3000
   npm start
   ```

3. Open `http://localhost:3000`. Keep Command Prompt open while using the app.

The app's fallback web port when no port environment variable is set is `12019`. The Windows helper sets `PORT=3000` for convenience. The web dashboard uses TCP; the Bedrock relay uses UDP.

## Data and uploads

By default, writable application data is stored under `data/` in the project folder. The app creates these folders automatically:

- `data/schematics/`: schematic files used by the build preview.
- `data/resource-packs/`: uploaded `.mcpack` and related resource-pack files.
- `data/addons/`: uploaded add-on files.
- `data/profiles/` and `data/host-auth/`: authentication/profile state used by the relay and Friends portal.
- `data/state.json`: saved bridge state.

These files are intentionally excluded from Git. Back up `data/` if you want to preserve uploaded files and sign-in state. Do not upload or commit authentication tokens, passwords, or private data.

Uploading a `.mcpack` or `.mcaddon` stores the file in the dashboard. **It does not install the pack on a PS5.** Console pack installation is separate.

## Schematic viewer and commands

The browser viewer is a companion planning tool. It supports supported `.schem` and legacy `.schematic` files and has safety limits to protect phones and small hosts: at most 100,000 blocks of schematic volume, 512 blocks on any axis, and 30,000 solid blocks in a 3D viewer response.

The experimental in-game preview commands are:

- `/build start <filename>` or `.build start <filename>`
- `/build move <x> <y> <z>`
- `/build place`
- `/build stop`
- `/build status`

Use the filename of a schematic uploaded into `data/schematics/`. The in-game preview currently has a 2,500-block cap and depends on the Bedrock protocol and block mappings matching your game/server. Treat it as experimental and test with a small schematic first.

**Important:** The preview is client-side only. `/build place` locks the preview position; it does **not** place real blocks on the server. The browser 3D viewer does not read your live PS5 world, automatically detect placed blocks, or install packs on the console.

## Connecting a PS5 to a server

Running the dashboard on your laptop only makes the website available locally. It does not automatically make the relay reachable from a PS5 over the internet.

For the Friends portal to route game traffic through Ghost Bridge, configure a real, publicly reachable UDP endpoint that forwards to the app's `RELAY_PORT`. Set:

- `RELAY_PORT`: the UDP port the relay listens on (default `19134`).
- `RELAY_PUBLIC_HOST`: the public IP address or hostname of the UDP endpoint.
- `RELAY_PUBLIC_PORT`: the public UDP port forwarded to `RELAY_PORT`.
- `ADMIN_PASSWORD`: a strong dashboard password.
- `DATA_DIR`: optional writable persistent data directory.

An HTTP website URL alone is not a UDP endpoint. Home-router port forwarding may also be unavailable behind carrier-grade NAT or an ISP firewall. Some servers restrict proxying or automation; only use the relay where permitted.

## Optional deployment

- **Docker/Compose:** `Dockerfile` and `compose.yaml`. Compose stores application data in a single persistent `ghost_data` volume and publishes TCP 8080 plus UDP 19134.
- **Ubuntu VPS:** `deploy/setup-ubuntu.sh` and [DEPLOY-UDP.md](DEPLOY-UDP.md).
- **Render:** `render.yaml` can host the HTTP dashboard, but an HTTP-only service does not provide the public UDP relay required for full console relay functionality. A successful website deployment is not proof that PS5 traffic can reach the relay.

The GitHub Actions workflows check JavaScript syntax, start the HTTP service for a health check, and build the Docker image. These checks do not prove Xbox sign-in, UDP reachability, or live PS5/server compatibility.

## Troubleshooting

- **`node` or `npm` not found:** install Node.js 24 or newer, close Command Prompt, open it again, and retry.
- **`npm install` fails:** copy the full error from the terminal. Do not delete project files at random.
- **Port already in use:** close the other process using that port or set a different `PORT`.
- **Dashboard opens but the PS5 cannot join:** check the UDP endpoint, router/host firewall, public relay settings, Xbox sign-in, and the server's rules. The `/healthz` endpoint only checks the HTTP process.
- **A schematic does not preview:** first try a small `.schem` or `.schematic` file, check that it appears in the upload list, and review the dashboard logs.

Ghost Bridge is an independent community project and is not affiliated with Microsoft or Mojang.
