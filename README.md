# Graphify 在线版

21cmFAST 知识图谱工作台的独立部署副本，供团队成员通过浏览器访问。

## 目录性质

上游 `Graphify` 位于 `21cmFAST_fork/Graphify`，其后端按相对路径读取仓库上级目录
（`../docs/notes`、整个 21cmFAST 仓库根、`Graphify/data`）。本目录把运行所需的最小数据抽出，
成为一个不依赖 21cmFAST 仓库、可独立部署的副本。

## 数据构成

| 目录 | 内容 | 体积 |
| :--- | :--- | :--- |
| `data/graph.json` | 图谱本体 | 176 KB |
| `notes/` | 站点文档，58 篇 Markdown | 5.6 MB |
| `code/` | 源码索引（`src` / `scripts` / `tests`） | 27 MB |

上游目录中占空间的备份快照（15 MB）与 1.4 GB 的仓库本体均已剔除。

## 部署到 Render

### 方式一：Blueprint

1. 将本目录推送到一个 GitHub 仓库。
2. Render → **New** → **Blueprint**，选中该仓库，`render.yaml` 会被自动识别。

### 方式二：手动创建 Web Service

Render → **New** → **Web Service**，填写：

| 配置项 | 值 |
| :--- | :--- |
| Runtime | `Node` |
| Build Command | `npm ci && npm run build` |
| Start Command | `node server/index.mjs` |
| Health Check Path | `/api/health` |

环境变量：

| 变量 | 值 |
| :--- | :--- |
| `NODE_ENV` | `production` |
| `GRAPHIFY_MD_DIR` | `notes` |
| `GRAPHIFY_CODE_DIR` | `code` |
| `GRAPHIFY_DATA_DIR` | `data` |

`PORT` 由 Render 自动注入，服务端已读取该变量。

**这三个 `GRAPHIFY_*` 变量必须设置**：`server/lib/paths.mjs` 的默认值指向 `21cmFAST_fork`
的上级目录，独立部署后需重指向本目录内。

部署完成后访问 Render 给出的 `https://<service-name>.onrender.com`。

## 用 Docker 部署

适用于自有服务器、Railway、Fly.io 等任意容器环境：

```bash
docker build -t graphify .
docker run -p 5178:5178 graphify
```

`Dockerfile` 已内置上述环境变量，无需在平台侧重复配置。

## 本地运行

```bash
npm ci
npm run build
GRAPHIFY_MD_DIR="$PWD/notes" \
GRAPHIFY_CODE_DIR="$PWD/code" \
GRAPHIFY_DATA_DIR="$PWD/data" \
node server/index.mjs
```

访问 `http://localhost:5178`。

## 已知限制

- **只读**：图谱数据在部署时固化。页面上的拖拽、连线、改标签等编辑不会持久化——
  Render 免费层的文件系统为临时存储，重启或重新部署即还原为仓库中的 `data/graph.json`。
- **冷启动**：Render 免费层闲置约 15 分钟后休眠，再次访问需等待约 1 分钟唤醒。
- **无访问控制**：站点为公开链接，持有 URL 即可访问，不带登录鉴权。如需限制范围，
  可在 Render 侧配置访问策略，或将仓库设为私有后再决定站点可见性。

## 与上游同步

本目录是上游 `Graphify` 的副本，**不自动同步**。上游应用代码或 `graph.json` 更新后，
需重新打包（复制应用文件 + `data/graph.json` + `notes/` + 源码索引）并推送，Render 会自动重新部署。
