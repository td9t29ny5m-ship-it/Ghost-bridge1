FROM node:20-bookworm-slim
ENV NODE_ENV=production
ENV FORCE_BUILD=1
WORKDIR /app

# raknet-native needs CMake and a C++ toolchain when a matching prebuilt
# binary is unavailable. Build tools stay in the image so npm can compile it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ cmake pkg-config \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
RUN mkdir -p /app/data /app/schematics /app/uploads \
 && chown -R node:node /app
USER node
EXPOSE 8080/tcp
EXPOSE 19134/udp
ENV PORT=8080
ENV WEB_PORT=8080
CMD ["node","index.js"]
