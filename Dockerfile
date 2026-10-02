FROM node:22-alpine

WORKDIR /app

# Dependencies first so this layer stays cached across code changes.
# --ignore-scripts because the postinstall build step needs the source files,
# which are only copied on the next line.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY . .

# Regenerate the Simplified-Chinese detection table from the OpenCC dictionaries.
RUN node tools/build.js

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
	CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["node", "src/server.js"]
