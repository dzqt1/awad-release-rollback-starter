FROM node:22.13-alpine3.21

WORKDIR /app

ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

COPY --chown=node:node src ./src
COPY --chown=node:node migrations ./migrations

RUN mkdir -p /data && chown node:node /data
VOLUME /data

USER node

EXPOSE 3000

HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
