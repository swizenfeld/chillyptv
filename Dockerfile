# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- run ----
FROM node:22-alpine
RUN apk add --no-cache ffmpeg tzdata
WORKDIR /app
ENV NODE_ENV=production PORT=8787 CHILLY_DATA_DIR=/data
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
VOLUME ["/data"]
EXPOSE 8787
USER node
CMD ["node", "dist-server/server/index.js"]
