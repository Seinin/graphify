# Graphify 生产镜像（Vite 构建 + Express 常驻服务）
# 用于 Render / Railway / Fly.io / 任意 VPS；走 Docker 时无需在平台侧配置环境变量。

# ---------- 构建阶段 ----------
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- 运行阶段 ----------
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY server ./server
COPY data ./data
COPY notes ./notes
COPY code ./code

# 数据目录默认值指向仓库上级，容器里必须显式覆盖
ENV GRAPHIFY_MD_DIR=/app/notes \
    GRAPHIFY_CODE_DIR=/app/code \
    GRAPHIFY_DATA_DIR=/app/data

EXPOSE 5178
CMD ["node", "server/index.mjs"]
