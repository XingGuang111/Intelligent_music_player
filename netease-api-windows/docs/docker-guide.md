# Docker 部署指南

> 本项目**当前以本机 Node 直跑为准**（`start-all.bat`）。Docker 是长期运行的备选方案：
> 容器配置（Dockerfile + 两个 compose 文件）已全部写好，只等 Docker 环境就绪后启用。
> 本文档记录从"修复 Docker 环境"到"容器跑起来"的完整步骤。

## 0. 当前状态（2026-09-22 实测）

**Docker 环境已就绪，全部落在 D 盘，hello-world 全链路验证通过。**

| 项目 | 状态 |
| --- | --- |
| Docker Desktop | **4.92.0.240144**，装在 `D:\Program Files\Docker\` |
| 引擎 / CLI | Docker **29.8.0**，Compose **v5.5.1**，`docker ps` / `hello-world` 正常 |
| 数据目录 | `D:\Docker\wsl`（镜像/容器数据，C 盘零占用） |
| 旧版 4.1.1 | 已卸载，C 盘残留（Program Files、ProgramData、AppData ×3、.docker）已全部清除 |
| 镜像加速 | `C:\Users\xing\.docker\daemon.json` 已配 registry-mirrors（daocloud、1ms）——docker.io 直连被 DNS 污染，必须走镜像站 |
| 项目容器 | **已构建运行**：`netease-api`（3000）+ `netease-player`（8080）双服务 Up (healthy)，冒烟 7/7 通过，容器内登录态正常（见 §3） |

注意事项：

- **PATH 要开新终端才生效**：安装器已把 `D:\Program Files\Docker\resources\bin` 写入系统 PATH，但安装前已打开的终端/IDE 里 `docker` 命令不可用（报 `docker-credential-desktop not found` 就是这个原因）——重开终端即可。
- 官方源（desktop.docker.com）在本机直连不通，安装包是浏览器经代理下载的；引擎拉镜像（docker.io）直连也被 DNS 污染（解析到 104.244.x.x 超时），且 **BuildKit 构建不走系统代理**——只能靠 registry-mirrors，已配置好。
- 下文 §2 是当时的修复过程记录，已执行完毕，无需再跑；新机器部署时可直接参考 §3。

## 1. 什么时候需要 Docker？

| 场景 | 建议 |
| --- | --- |
| 日常听歌、开发调试 | 不需要。`start-all.bat` 足够 |
| 开机自启、长期后台运行 | 需要。容器 `restart: unless-stopped` 会自动拉起 |
| 换机器部署 | 需要。一条 `docker compose up -d` 即可复现环境 |

## 2. 第一步：修复 Docker 环境

### 方案 A：先试启动现有安装（5 分钟，可能失败）

1. 开始菜单打开 **Docker Desktop**
2. 如果弹出许可协议（License Agreement）窗口 → 勾选接受 → 等待引擎启动（右下角鲸鱼图标变绿/不再动画）
3. 验证：

   ```
   docker info
   ```

   能输出版本信息（而不是 panic 或长时间卡住）即成功，跳到 §3。
   如果起不来、报错或卡死 → 用方案 B。

### 方案 B：卸载重装最新版到 D 盘（推荐）

旧版在 C 盘且过老，直接重装最干净。

1. **卸载**：设置 → 应用 → Docker Desktop → 卸载。完成后重启电脑。
2. **下载**：https://www.docker.com/products/docker-desktop/ 下载最新 Windows 安装包。
3. **指定 D 盘路径安装**（关键——默认装 C 盘，镜像数据会持续增长撑爆系统盘）。管理员身份运行 PowerShell：

   ```powershell
   # 在安装包所在目录执行
   Start-Process -FilePath ".\Docker Desktop Installer.exe" -ArgumentList `
     'install', '--accept-license',
     '--installation-dir="D:\Program Files\Docker"',
     '--wsl-default-data-root="D:\Docker\wsl"' `
     -Wait
   ```

   - `--installation-dir`：程序本体位置
   - `--wsl-default-data-root`：**镜像/容器数据的位置（大头，必须放 D 盘）**

4. 安装完成后启动 Docker Desktop，首次会初始化 WSL 后端，等鲸鱼图标稳定。
5. 验证：

   ```
   docker --version
   docker info
   docker run --rm hello-world
   ```

   三条都通 → 环境就绪。

> 若公司网络拉取镜像慢：Docker Desktop → Settings → Docker Engine，在 JSON 里加
> `"registry-mirrors": ["https://docker.m.daocloud.io"]`，Apply & Restart。

## 3. 第二步：构建并启动（生产模式）

在项目目录（`netease-api-windows/`，也就是本文件的上两级）执行：

```
docker compose up -d --build
```

这一步会：按 Dockerfile 构建镜像（首次约 3~10 分钟，要拉基础镜像和 npm 依赖）→ 创建并后台启动容器 → 配置开机/崩溃自动拉起（`restart: unless-stopped`）。

日常启动（已构建过，不用 --build）：

```
docker compose up -d
```

**确认 `.env` 已配好再启动**——容器通过 bind mount `./.env:/app/.env` 与宿主机**共用同一份 .env**：容器内网页扫码登录会直接写回宿主机文件，容器重建不丢登录态。没配 Cookie 也能跑，只是未登录状态。

> 注意方向性：容器内改 `.env`（扫码登录）宿主机立即可见；但**宿主机改 `.env` 不会触发容器内的 fs.watch 热加载**（Docker Desktop 挂载的已知限制），宿主机侧改完要 `docker compose restart`。另外 `config.js` 启动时会用 `process.env.NCM_COOKIE` 兜底（compose 的 `env_file` 也注入了它），所以即使去掉挂载也能读到启动时的 Cookie。

## 4. 第三步：验证

```
docker compose ps          :: netease-api 与 netease-player 都应显示 Up ... (healthy)
docker compose logs -f     :: 应看到 listening on http://0.0.0.0:3000
curl http://localhost:3000/health       :: API 直连
curl http://localhost:8080/api/health   :: 经播放器容器代理，应返回同样的 JSON
```

`/health` 返回 `{"status":"ok",...}` 即成功。再跑冒烟测试（打容器，和打本机一样）：

```
npm run smoke
```

> 容器是**双服务**：`netease-api`（3000）+ `netease-player`（8080，与 API 共用镜像，经 `API_BASE=http://netease-api:3000` 走 compose 内部服务名访问 API）。`docker compose up -d` 一起拉起，浏览器直接开 `http://localhost:8080`，无需再跑 `npm run player`。

## 5. 日常运维

| 操作 | 命令 |
| --- | --- |
| 看状态 | `docker compose ps` |
| 看日志 | `docker compose logs -f`（Ctrl+C 退出，容器不停） |
| 重启 | `docker compose restart` |
| 停止 | `docker compose stop`（保留容器，下次 `start` 秒起） |
| 停止并删除 | `docker compose down`（镜像还在） |
| **改了 Cookie（.env）** | `docker compose restart` —— 不必重新构建 |
| **改了代码** | `docker compose up -d --build` —— 必须重新构建（生产模式代码是拷进镜像的） |
| 升级上游依赖 | 改 `package.json` 版本号后 `docker compose up -d --build` |
| 进容器排错 | `docker compose exec netease-api sh` |

**开机自启**：无需额外配置。只要 Docker Desktop 设置了开机启动（默认勾选），`restart: unless-stopped` 会在 Docker 引擎起来后自动拉起容器。

## 6. 开发模式（改代码立即生效，不重新构建）

叠加 dev 配置文件启动：

```
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

原理：把宿主机源码整个挂进容器（`.:/app`）+ 用 `node --watch` 启动，改文件自动重启进程；匿名卷 `/app/node_modules` 保护容器内 Linux 版依赖不被 Windows 版覆盖。

退出开发模式，回到生产：

```
docker compose up -d --build
```

## 7. 与本机直跑的切换

容器和 `start-all.bat` **不能同时用**——都抢 3000 端口。

- 从本机切到 Docker：先 `stop.bat`，再 `docker compose up -d`
- 从 Docker 切回本机：先 `docker compose stop`，再 `start-all.bat`

## 8. 常见问题

**`docker compose` 报 "unknown command"？**
老版本用带横线的 `docker-compose`。本指南命令按 v2 写法；若你的版本旧，把 `docker compose` 全换成 `docker-compose`（重装新版后不存在此问题）。

**构建时拉 `node:22-bookworm-slim` 很慢或超时？**
docker.io 直连被 DNS 污染时表现为卡 0B 或直接超时。本机已配 registry-mirrors（见 §0），仍慢就换镜像站。注意挂系统代理对 BuildKit 无效。

**构建时 `apt-get update` 报 502 Bad Gateway？**
deb.debian.org 同样被污染。本项目 Dockerfile 已**不需要 apt**——基础镜像自带 tzdata，健康检查用 `node fetch` 而非 curl，整个 apt 步骤已删除。自己扩展镜像时把 apt 源 sed 成 `mirrors.ustc.edu.cn` 即可。

**容器起来了但 `localhost:3000` 打不开？**
`docker compose ps` 看端口映射是否是 `0.0.0.0:3000->3000/tcp`；再查宿主机 3000 是否被别的东西占了（`stop.bat` 能查杀）。

**C 盘空间告急？**
镜像数据在 WSL 虚拟磁盘里。重装时用 `--wsl-default-data-root` 放到 D 盘（§2）；已装好的可用 `wsl --export` / `--import` 迁移，或 Docker Desktop → Settings → Resources → Advanced 修改磁盘镜像位置。

**想彻底删掉？**
`docker compose down --rmi local`（删容器和本项目镜像），缓存层想清就 `docker system prune`。

---

相关文档：[README.md](../README.md)（快速上手）、[cookie-guide.md](cookie-guide.md)（登录态）、技术原理见根目录技术文档 `README.md` §六。
