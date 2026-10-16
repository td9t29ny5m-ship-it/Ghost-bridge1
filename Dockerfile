FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
RUN mkdir -p /app/data /app/schematics /app/uploads && chown -R node:node /app
USER node
EXPOSE 8080/tcp
EXPOSE 19134/udp
ENV PORT=8080
ENV WEB_PORT=8080
CMD ["node","index.js"]
