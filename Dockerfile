FROM node:24-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/app/data
ENV RELAY_PORT=19134

WORKDIR /app

# Some Bedrock networking dependencies may need native compilation.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ cmake pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

RUN mkdir -p /app/data \
    && chown -R node:node /app

USER node

EXPOSE 8080/tcp
EXPOSE 19134/udp

CMD ["npm", "start"]
