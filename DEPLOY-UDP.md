# Ghost Bridge deployment (UDP-capable server)

Ghost Bridge needs a Linux host or network that permits public UDP traffic. A website-only platform that exposes only HTTP/HTTPS can serve the dashboard but cannot provide the Bedrock relay required for the full console connection.

## Included deployment options

- Docker image and Compose configuration.
- Ubuntu VPS setup script using Node.js 24 or newer.
- GitHub Actions container-build check.

## Deploy with Docker Compose

1. Install Docker Engine and the Compose plugin on a Linux VPS with a public IPv4 address.
2. Clone this repository and enter its directory.
3. Create a local `.env` file containing a strong dashboard password:

   ```dotenv
   ADMIN_PASSWORD=replace-this-with-a-long-random-password
   ```

4. Build and start the app:

   ```sh
   docker compose up -d --build
   docker compose ps
   docker compose logs -f ghost-bridge
   ```

5. Allow inbound TCP 8080 and UDP 19134 in the VPS firewall and cloud security rules.
6. Open `http://YOUR_SERVER_IP:8080` for the dashboard.

Compose persists application data in the `ghost_data` volume. Back it up before recreating the volume. Do not commit your `.env` file.

## Deploy on Ubuntu without Docker

From the repository directory, run `sudo bash deploy/setup-ubuntu.sh`. The script installs Node.js 24 if needed, installs packages, creates a systemd service, and opens TCP 3000 and UDP 19134 in UFW when UFW is active.

## Public UDP configuration

- `RELAY_PORT`: internal UDP port the app listens on (default 19134).
- `RELAY_PUBLIC_HOST`: public IP or hostname that console clients can reach over UDP.
- `RELAY_PUBLIC_PORT`: public UDP port forwarded to `RELAY_PORT`.
- `ADMIN_PASSWORD`: strong dashboard password.
- `DATA_DIR`: writable persistent storage path.

Do not set `RELAY_PUBLIC_HOST` to the HTTP dashboard URL. It must point to an actual UDP endpoint forwarding traffic to the app.

## Important validation

A running HTTP dashboard or successful `/healthz` response does not prove UDP reachability, Xbox Friends-portal compatibility, or in-game schematic preview compatibility. Test those separately with a Bedrock client before relying on the service.

Without a public UDP endpoint, the portal may use a direct-join fallback, which bypasses the relay and its schematic interception. Some public servers may prohibit proxying or automation.
