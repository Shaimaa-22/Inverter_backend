FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies first for better Docker layer caching.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --chown=node:node . .

USER node
EXPOSE 3000

CMD ["node", "src/server.js"]
