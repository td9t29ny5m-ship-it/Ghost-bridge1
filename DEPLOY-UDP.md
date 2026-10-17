## Ghost Bridge deployment (UDP-capable server)

This project needs a Linux host that permits public UDP traffic. A website-only platform that exposes only HTTP/HTTPS will not run the Bedrock relay.

### Included
- Docker image for the existing Node.js application.
- Compose file publishing the dashboard on TCP 8080 and relay port on UDP 19134.
- Persistent volumes for data, schematics and uploads.
- GitHub Actions container-build check.

### Deploy on a Linux VPS
1. Create a Linux VPS with Docker/Compose support and public IPv4. Confirm its firewall/security group allows inbound TCP 8080 and UDP 19134. Do not use a web-only or Minecraft-game-server-only plan.
2. On the VPS, clone this repository and enter its folder.
3. Run: docker compose up -d --build
4. Check: docker compose ps and docker compose logs --tail=100 ghost-bridge
5. Open http://YOUR_SERVER_IP:8080 for the dashboard.
6. For a public website, point a domain to the VPS and put an HTTPS reverse proxy (Caddy or Nginx) in front of TCP 8080. The Bedrock relay remains UDP and must be reachable directly on its published UDP port.

### Important validation
This Compose file is a deployment foundation, not proof that the current relay implementation successfully binds UDP 19134. Confirm the application logs show the relay listening on the expected port and test an actual Bedrock client. If the current application uses a different relay port, change the UDP mapping and the app relay-port setting together.

Do not expose admin or upload endpoints publicly until authentication is enabled and default credentials are changed. Never commit Microsoft/Xbox tokens, passwords, or .env secrets to GitHub.


### Without public UDP
The dashboard can still start the Xbox Friends portal by redirecting its invite directly to the selected Bedrock destination when `RELAY_PUBLIC_HOST` is not set. This is a compatibility fallback for the invite/join flow only: it bypasses the Ghost Bridge UDP relay, so schematic traffic interception and in-game preview commands cannot operate over that direct connection. For those features, provide a real public UDP endpoint that forwards to the app's `RELAY_PORT`.
