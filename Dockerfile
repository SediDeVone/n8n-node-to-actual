FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better layer caching
COPY package.json package-lock.json ./
RUN npm ci

# Copy sources and build
COPY tsconfig.json ./
COPY src ./src
COPY index.ts ./index.ts
COPY nodes ./nodes
COPY credentials ./credentials

RUN npm run build

EXPOSE 7006

ENV NODE_ENV=production

CMD ["node", "dist/src/server.js"]
