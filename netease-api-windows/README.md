# 网易云音乐 API 服务（Windows 本地版）

封装网易云音乐官方接口的加密与签名逻辑，对外提供简洁的 RESTful 接口。基于 `@neteasecloudmusicapienhanced/api` v4.40.1。

起步只要一条命令：

```
start-all.bat
```

它会自动：拉起 API(3000) → 起播放器(8080) → 打开浏览器。**打开页面时会自己判断登录态**，详见下面「网页内登录」。

手动分开跑也行：

```
start.bat          :: 只启动 API 服务（3000，首次运行会自动装依赖）
npm run player     :: 只启动网页播放器（8080）
stop.bat           :: 两个一起停
```

服务默认监听 `http://localhost:3000`，播放器在 `http://localhost:8080`。

## 网页内登录（不用敲命令）

打开播放器页面时，它会自动检查账号状态，然后决定要不要弹提示：

| 页面检测到的情况 | 表现 | 你的选择 |
| --- | --- | --- |
| **没有账号信息**（`.env` 没配 Cookie） | 弹出登录框 | 点「扫码登录」，或「跳过，仅试听」 |
| **登录态失效**（改过密码 / 换设备 / 太久没登录） | 弹出框提示「登录态已失效」 | 重新扫码恢复，或跳过继续试听 |
| **已登录** | 右上角显示头像 + 昵称 | 想换号点「退出登录」 |

扫码用的是网易云音乐 App。**成功后 Cookie 自动写入 `.env` 并立即生效**，下次打开不用再扫。

- 不登录也能用，只是每首只有 **30~45 秒试听片段**（实测 128kbps）。
- 跳过之后随时可以点右上角「登录」重新扫码。
- 习惯命令行的话，`npm run qrlogin` 依然可用，效果一样。
- 想排查登录问题见 `docs/cookie-guide.md`。

> 播放器通过 `/api/*` 同源反向代理访问 API，所以不存在跨域问题。

## 播放音乐（最短路径）

**1. 一键启动**

双击 `start-all.bat`（或在项目目录执行 `start-all.bat`）。它会自动：起 API → 等它就绪 → 起播放器 → 打开浏览器。

**2. 登录 或 跳过**

首次打开会弹出登录框，按上一节的说明二选一即可。

**3. 搜歌名，点播放**

浏览器停在 `http://localhost:8080`，输入歌名回车，点列表里的歌。

命令行下也可以自检：

```
npm run smoke      :: 冒烟测试，7 个核心接口
npm run status     :: 检查登录态
npm run qrlogin    :: 命令行扫码登录（网页内登录的备选）
```

## 已验证的接口

在 Windows 本机实测通过：

**数据接口（7/7，均无需登录即可返回）**

| 接口 | 路径 | 需要登录 |
| --- | --- | --- |
| 健康检查 | `/health` | 否 |
| 搜索单曲 | `/search?keywords=xxx&type=1` | 否 |
| 搜索歌单 | `/search?keywords=xxx&type=1000` | 否 |
| 歌曲详情 | `/song/detail?ids=347230` | 否 |
| 歌词 | `/lyric?id=347230` | 否 |
| 歌单详情 | `/playlist/detail?id=24381616` | 否 |
| 登录状态 | `/login/status` | 否（查状态） |
| 播放链接 | `/song/url?id=347230&level=exhigh` | 否（未登录只有试听片段） |

**网页登录接口（本项目新增，供 `player.html` 使用）**

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/auth/status` | GET | 返回 `{ loggedIn, profile, cookieConfigured, reason }`；`reason` 可能为 `ok` / `anonymous`（没配 Cookie）/ `expired`（失效） |
| `/auth/qr/create` | GET | 返回 `{ key, qrimg }`，`qrimg` 是可直接 `<img src>` 的 base64 data URL |
| `/auth/qr/check?key=` | GET | 轮询扫码结果：`801` 等待扫码 / `802` 待确认 / `800` 已过期 / `803` 成功（同时写 `.env`） |
| `/auth/logout` | POST | 清空 `.env` 里的 Cookie |

完整接口列表见服务启动后的文档页，或查看 `node_modules/@neteasecloudmusicapienhanced/api/module/`。

## 命令一览

| 命令 | 作用 |
| --- | --- |
| `start-all.bat` | 一键启动 API + 播放器，并自动打开浏览器（推荐） |
| `stop.bat` | 停止 API（3000）与播放器（8080） |
| `start.bat` | 只启动 API 服务；首次运行会自动 `npm install` |
| `npm run player` | 只启动网页播放器（本机直跑时用；容器模式不需要，8080 由容器提供） |
| `npm run qrlogin` | 扫码登录，Cookie 自动写入 `.env` 并热加载生效 |
| `npm run status` | 检查当前登录态 |
| `npm run smoke` | 冒烟测试 7 个核心接口 |
| `npm run dev` | 开发模式（`node --watch`），改代码自动重启 |

## 目录结构

```
netease-api-windows/
├── src/
│   ├── index.js              # 服务入口：外层 Express（Cookie 注入 + /health + /auth/*）+ 内层官方 API
│   ├── config.js             # 读 .env，fs.watch 监听变更 → Cookie 热加载
│   └── env-store.js          # .env 中 NCM_COOKIE 的读写（服务与 qr-login 脚本共用）
├── scripts/
│   ├── qr-login.js           # 命令行扫码登录，成功后自动写 .env
│   ├── check-login-status.js # 登录态检查
│   ├── smoke-test.js         # 接口冒烟测试
│   ├── serve-player.js       # 播放器静态服务 8080 + /api 反向代理到 3000（转发 GET/POST）
│   └── wait-ready.js         # 轮询 URL 直到就绪（被 start-all.bat 用于启动排序）
├── public/
│   └── player.html           # 网页播放器：登录弹层 + 搜索 / 播放 / 歌词 / 账号信息
├── docs/
│   ├── cookie-guide.md       # Cookie 获取 / 更新 / 排错
│   ├── api-examples.md       # 调用示例（curl / PowerShell / Python）
│   └── docker-guide.md       # Docker 环境修复与部署运维全步骤
├── start-all.bat             # 一键启动 API + 播放器并打开浏览器
├── start.bat                 # 只启动 API
├── stop.bat                  # 停止 API + 播放器
├── Dockerfile                # 容器镜像（node:22-bookworm-slim）
├── docker-compose.yml        # 生产容器编排：API + 播放器双服务共用镜像（restart unless-stopped）
├── docker-compose.dev.yml    # 开发容器（挂源码 + 热重载）
├── .env.example              # 配置模板（首次运行自动复制为 .env）
└── package.json
```

## 配置

复制 `.env.example` 为 `.env` 后修改：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `NCM_COOKIE` | 空 | 登录态 Cookie，留空则只能调公开接口 |
| `LOG_LEVEL` | `info` | 日志级别 |

## 架构说明

服务是**双层结构**，这是为了在不改动上游包的前提下支持全局 Cookie：

```
外部请求 :3000
    ↓
外层 Express（src/index.js）
    ├─ /health                     健康检查
    ├─ Cookie 注入：请求没带 Cookie 时，补上 .env 的 NCM_COOKIE
    └─ 其余请求 → 进程内直调内层 app（无网络开销）
                    ↓
              内层 serveNcmApi（只监听 127.0.0.1 的随机端口，不对外）
```

这样做的好处：上游包升级时只需改一行依赖版本，本项目的逻辑不受影响。

## 容器模式：两个容器在哪个文件、怎么配合

**三个 Docker 文件各管一件事：**

| 文件 | 职责 |
| --- | --- |
| `Dockerfile` | 构建**唯一镜像** `netease-api:1.0.0`（Node 22 + 依赖 + 全部代码），两个容器共用 |
| `docker-compose.yml` | **定义两个容器**：`netease-api`（跑 `src/index.js`）和 `netease-player`（同镜像，`command` 覆盖为跑 `scripts/serve-player.js`）；端口映射、`.env` 挂载、健康检查、开机自启都在这里 |
| `docker-compose.dev.yml` | 开发叠加配置：挂源码热重载（日常不用管） |

**整体流程：**

```
① 构建（一次性，改了代码才重做）
   docker compose up -d --build
   Dockerfile → 镜像 netease-api:1.0.0
                      │ 同一镜像，两条启动命令
        ┌─────────────┴──────────────┐
        ↓                            ↓
netease-api 容器              netease-player 容器
node src/index.js             node scripts/serve-player.js
监听 3000                     监听 8080
挂载宿主机 ./.env             depends_on：等 API 健康检查通过才启动
（登录态共享，扫码写回宿主机）

② 请求链路
浏览器 → localhost:8080（player 容器）
           ├─ /       → 返回 player.html
           └─ /api/*  → 代理到 http://netease-api:3000
                        （compose 内部网络，服务名即域名；
                          容器内 127.0.0.1 是自己，不能用它找隔壁容器）
                          ↓ weapi/eapi 加密
                        网易云音乐服务器

③ 开机自启链
开机 → Docker Desktop 自启 → 引擎就绪
     → restart: unless-stopped 生效 → netease-api 起
     → /health 通过 → netease-player 起
     → 浏览器开 http://localhost:8080 直接用，全程不用敲命令
```

## 常见问题

**端口被占用**：改 `.env` 里的 `PORT`，或 `stop.bat` 先停掉旧进程。

**局域网内其他设备访问不了**：Windows 防火墙默认拦截入站。以管理员身份运行一次：

```
netsh advfirewall firewall add rule name="netease-api-3000" dir=in action=allow protocol=TCP localport=3000
```

**接口突然全部返回 301/-462**：Cookie 过期，按 `docs/cookie-guide.md` 重新扫码。

**上游接口变动**：升级依赖后重启即可。

```
npm update @neteasecloudmusicapienhanced/api
```

## 长期运行

### 方式一：Docker（推荐，环境已就绪）

> Docker Desktop 4.92 已装在 `D:\Program Files\Docker`，数据在 `D:\Docker\wsl`；**项目容器已构建运行**（API + 播放器双服务 Up healthy，冒烟 7/7 通过，容器内登录态正常）。运维细节见 **`docs/docker-guide.md`**。

```
docker compose up -d          :: 构建并后台启动（API 3000 + 播放器 8080 一起拉起），开机自动拉起
docker compose logs -f        :: 看日志
docker compose ps             :: 看状态（两个服务都 healthy 表示正常）
docker compose down           :: 停止并移除
```

容器模式下浏览器直接开 `http://localhost:8080` 即可，**不需要**再跑 `npm run player`（8080 已由 `netease-player` 容器提供）。

开发时想改代码立即生效，用热重载模式：

```
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

改 Cookie 后只需 `docker compose restart`，不必重新构建镜像。改了代码则要 `docker compose up -d --build`。

### 方式二：NSSM 注册为 Windows 服务

不装 Docker 时，用 NSSM 把服务注册为 Windows 服务：

1. 下载 NSSM（https://nssm.cc/download），解压到 `D:\Program Files\nssm`。
2. 管理员身份运行：

   ```
   nssm install netease-api
   ```

3. 在弹出的界面里填：
   - Path: `D:\nodejs\node.exe`
   - Startup directory: 本项目目录
   - Arguments: `src\index.js`
4. 安装后：`nssm start netease-api`

也可以用「任务计划程序」创建登录时触发的任务，勾选"使用最高权限运行"。

## 说明

本项目只做接口中转，不解密、不缓存、不分发任何音乐文件。上游包的"解锁灰色歌曲"功能（`ENABLE_GENERAL_UNBLOCK`）默认**未开启**，也不会开启——那是绕过版权保护的功能，不在本项目的目标范围内。请仅用于个人学习和合法用途。

---

## 更新记录

> 约定：本项目**每次代码/脚本/配置变更后，README 必须同步更新**（命令、目录结构、注意事项、本记录）。

| 日期 | 变更 |
| --- | --- |
| 2026-09-22 | 初版：搭建 `netease-api-windows/`，双层服务结构（外层 Express 注入 Cookie + `/health`），7 个核心接口实测通过 |
| 2026-09-22 | 修正播放链接接口路径：文档原写 `/song/url/v1`，实测在 v4.40.1 上返回 404，正确路径为 `/song/url` |
| 2026-09-22 | 新增网页播放器 `public/player.html` + 同源代理 `scripts/serve-player.js`（8080），新增 `npm run player` |
| 2026-09-22 | 扫码登录后 Cookie **自动写入 `.env`**，且 `config.js` 用 `fs.watch` 热加载，改 Cookie **无需重启服务** |
| 2026-09-22 | 修复 `.env` 解析 Bug：正则值两侧误用 `\s*`（会跨行匹配）导致空 Cookie 被读成下一行内容，改为 `[ \t]*` |
| 2026-09-22 | 补齐容器化资产：`Dockerfile` / `docker-compose.yml` / `docker-compose.dev.yml` |
| 2026-09-22 | 新增 `start-all.bat` 一键启停（带启动就绪检测）、`scripts/wait-ready.js`；`stop.bat` 扩展为同时停 3000 与 8080 |
| 2026-09-22 | **登录整合进播放器页面**：打开页面自动判断登录态——没账号 / 登录态失效（改密码等）都会弹「扫码登录 / 跳过」，登录后右上角显示头像昵称，可「退出登录」 |
| 2026-09-22 | 新增网页登录接口 `/auth/status`、`/auth/qr/create`（返回 base64 二维码）、`/auth/qr/check`、`/auth/logout`；`serve-player.js` 代理支持转发 POST |
| 2026-09-22 | 抽出 `src/env-store.js` 统一 `.env` 读写，服务与 `qr-login` 脚本共用同一实现，消除重复逻辑 |
| 2026-09-22 | 技术文档 `REMAD.md` 全量同步：补登录门禁设计（`/auth/*` 路由顺序、三态判定、双链路）、`env-store.js` 模块、代理 POST 转发、Docker 环境实测状态，新增踩坑 7~10 条 |
| 2026-09-22 | 登录链路全量实测通过：`/auth/*` 四接口、logout → `anonymous` → 恢复 `.env` → `fs.watch` 热加载回 `ok`、播放器代理 GET/POST 透传；8 个 JS 文件语法检查通过 |
| 2026-09-22 | 新增 `docs/docker-guide.md`：Docker 环境现状实测（CLI 20.10.8 在 C 盘、引擎未运行）、重装到 D 盘步骤、生产/开发两种部署与日常运维命令 |
| 2026-09-22 | **Docker 环境修复完成**：卸载 C 盘旧版 4.1.1 并清除全部残留，Docker Desktop 4.92.0 安装至 `D:\Program Files\Docker`（数据目录 `D:\Docker\wsl`），引擎 29.8.0 + Compose v5.5.1，hello-world 验证通过 |
| 2026-09-22 | **项目容器跑通**：`docker compose up -d --build` 成功，容器 Up (healthy)，冒烟 7/7 通过，容器内 `/login/status` 登录态正常；docker.io 直连被 DNS 污染且 BuildKit 不走系统代理，配 `daemon.json` registry-mirrors（daocloud/1ms）解决 |
| 2026-09-22 | Dockerfile 精简：删除整个 apt 步骤——实测基础镜像自带 tzdata，健康检查用 `node fetch` 不需要 curl（顺带绕开 deb.debian.org 被污染的 502 问题） |
| 2026-09-22 | 容器 Cookie 链路修复：compose 挂载 `./.env:/app/.env`（容器内扫码登录直接写回宿主机，重建不丢登录态）；`config.js` 启动时增加 `process.env.NCM_COOKIE` 兜底（watcher 不兜底，避免登出被复活） |
| 2026-09-22 | 冗余清理：删 `dotenv` 依赖（代码未引用）、`src/routes/` 空目录、旧 Docker 安装包（527MB）；`check-login-status.js` 过时提示改扫码引导；player.html 删未使用变量；`.env` 混入的 JSON 污染行清除 |
| 2026-09-22 | `cookie-guide.md` 补容器模式说明：宿主机手改 `.env` 不触发容器内热加载，需 `docker compose restart` |
| 2026-09-22 | **播放器容器化**：compose 新增 `netease-player` 服务（与 API 共用镜像，`command` 覆盖启动命令，`depends_on: service_healthy` 等 API 就绪），`serve-player.js` 支持 `API_BASE` 环境变量（容器内经服务名 `http://netease-api:3000` 访问 API）；容器模式开浏览器即用，无需 `npm run player`。端到端实测：页面 200、代理透传、登录态正常 |
| 2026-09-22 | 根目录技术文档由 `REMAD.md` 更名为 `README.md`（用户操作），全文交叉引用已同步 |
| 2026-09-22 | README 新增「容器模式：两个容器在哪个文件、怎么配合」一节：三个 Docker 文件职责表 + 构建/请求链路/开机自启链三段流程图 |
| 2026-09-22 | GitHub 上传准备：新增根目录 `.gitignore`（凭证 `.env`、依赖、日志、`.claude/`、`.workbuddy/`、系统文件），子项目 `.gitignore` 补 Windows 系统文件；`git add -n` 实测 25 个文件入选、`.env` 确认被排除 |
| 2026-09-22 | 删除 `.env.bak-json-pollution` 临时备份（Cookie 与现 .env 一致，冗余且多存一份明文凭证）；`REMAD.md` 重构：新增完整文件结构与各文件作用、测试流程章节（快速自检/接口/播放器/登录链路/容器专项/模式切换 6 组案例）、命令速查表，删除过时的"原计划执行情况对照"与"本次改动"类历史标注，踩坑记录补至 16 条 |
| 2026-09-22 | 服务增加 SIGTERM/SIGINT 优雅退出：Node 作为容器 PID 1 时默认忽略 SIGTERM，`docker stop` 只能等 10 秒强杀（退出码 137）；装 handler 后 stop 约 1 秒、退出码 0 |
