# Opt-in image for recap videos (docs/specs/recap-videos-specs.md): the app plus what HyperFrames
# needs to render - Node 22, Chromium, FFmpeg and fonts for Hebrew text and emoji.
#
# Production keeps Railway's automatic build until you opt in: set the service variable
#   RAILWAY_DOCKERFILE_PATH=deploy/recaps.Dockerfile
# plus RECAPS_ENABLED=true. Removing the variable goes back to the automatic build.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium ffmpeg fonts-noto-core fonts-noto-color-emoji ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# HyperFrames finds /usr/bin/chromium on its own; set explicitly so a renamed binary fails loudly.
ENV HYPERFRAMES_BROWSER_PATH=/usr/bin/chromium \
    HYPERFRAMES_NO_TELEMETRY=1 \
    NODE_ENV=production

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

CMD ["node", "server.js"]
