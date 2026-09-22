FROM node:22-bookworm-slim

ENV TZ=Asia/Shanghai \
    NODE_ENV=production

# 时区：基础镜像已自带 tzdata，只需软链（健康检查用 node fetch，不需要 curl）
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime

WORKDIR /app

# 先只拷依赖清单，利用 Docker 层缓存（改代码不会重装依赖）
COPY package.json package-lock.json ./
RUN npm config set registry https://registry.npmmirror.com \
    && npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY . .

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
