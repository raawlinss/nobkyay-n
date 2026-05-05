FROM node:20-alpine

WORKDIR /app

# Install MediaMTX for WHIP/WHEP streaming
RUN apk add --no-cache curl tar \
 && ARCH=$(case "$(uname -m)" in x86_64) echo "amd64";; aarch64) echo "arm64v8";; *) echo "amd64";; esac) \
 && curl -fSL "https://github.com/bluenviron/mediamtx/releases/download/v1.12.2/mediamtx_v1.12.2_linux_${ARCH}.tar.gz" \
    -o /tmp/mediamtx.tar.gz \
 && tar xzf /tmp/mediamtx.tar.gz -C /usr/local/bin mediamtx \
 && rm /tmp/mediamtx.tar.gz \
 && chmod +x /usr/local/bin/mediamtx

COPY package.json /app/package.json
RUN npm install --omit=dev

COPY server.js /app/server.js
COPY mediamtx.yml /app/mediamtx.yml
COPY public /app/public

# Start script: launch MediaMTX in background, then Node.js
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

ENV NODE_ENV=production
ENV PORT=7860

EXPOSE 7860

CMD ["/app/start.sh"]
