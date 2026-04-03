FROM node:18-alpine

LABEL maintainer="Nightscout Contributors"

WORKDIR /opt/app
COPY package*.json ./

RUN npm install --cache /tmp/empty-cache && rm -rf /tmp/*

COPY . .

RUN npm run postinstall && npm run env || true

# Create buffer directory for disk-based data persistence
RUN mkdir -p /data/buffer && chown node:node /data/buffer

ENV NIGHTSCOUT_BUFFER_DIR=/data/buffer

USER node
EXPOSE 1337

CMD ["node", "lib/server/server.js"]
