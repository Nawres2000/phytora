# Express gateway (auth, history, chatbot). Stage 1: production dependencies only
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Stage 2: runtime as the unprivileged "node" user
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY data ./data
USER node
EXPOSE 5000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 CMD wget -qO- http://127.0.0.1:5000/health || exit 1
CMD ["node", "src/index.js"]
