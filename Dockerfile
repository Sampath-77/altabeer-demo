FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY prisma ./prisma/
RUN npm install --ignore-scripts
COPY . .
RUN npx prisma generate && npm run build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* && useradd -r -u 1001 app
COPY --from=build /app ./
RUN mkdir -p /data/storage && chown -R app /data /app/.next
USER app
EXPOSE 3000
# Web: `npm start`. Worker: `npm run worker` (same image, different command).
CMD ["npm", "start"]
