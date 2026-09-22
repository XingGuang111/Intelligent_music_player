# 智能音乐播放器 · 系统技术文档

> 本文档记录 `netease-api-windows/` 系统的**实际实现细节、文件职责、测试流程与技术原理**。
> 使用说明（怎么启动、怎么扫码）见 `netease-api-windows/README.md`，本文档侧重"系统是怎么工作的、怎么验证它工作正常"。

## 一、系统概览

在 Windows 本机运行的网易云音乐中转与播放系统，由**两个常驻进程**组成：

| 组件 | 进程 | 端口 | 职责 |
| --- | --- | --- | --- |
| API 中转服务 | `node src/index.js`（或容器） | 3000 | 封装网易云接口，对外提供 RESTful API；并提供 `/auth/*` 网页登录接口 |
| 网页播放器 | `node scripts/serve-player.js` | 8080 | 静态页面 + `/api/*` 反向代理到 3000 |

```
浏览器 ──→ http://localhost:8080 ──→ serve-player.js（同源反代 /api/*，支持 GET/POST）
                                        │
                                        ↓
                              http://127.0.0.1:3000（外层 Express）
                                        │
                    ┌───────────────────┴───────────────────┐
                    ↓                                        ↓
          /auth/* 登录门禁（无 Cookie 注入）        其余请求（先注入 Cookie 再放行）
                    │                                        │ 进程内直调，无网络跳转
                    └───────────────────┬───────────────────┘
                                        ↓
                              serveNcmApi（127.0.0.1:随机端口，不对外）
                                        │ weapi/eapi 加密签名
                                        ↓
                                  网易云音乐服务器
```

两种运行形态（**不能同时用**，都抢 3000/8080 端口）：

- **本机直跑**：`start-all.bat`，日常听歌、开发调试用这个
- **Docker 容器**：`docker compose up -d` 拉起**双容器**（`netease-api` 3000 + `netease-player` 8080，共用同一镜像），长期后台/开机自启用这个（见 §六）

## 二、文件结构与各文件作用

```
Intelligent_music_player/
├── README.md                    # 本文档：技术原理 + 文件说明 + 测试流程
└── netease-api-windows/         # 系统本体（所有命令都在此目录内执行）
    ├── src/                     # 服务核心代码
    │   ├── index.js             # 服务入口：双层架构（§三）、/auth/* 登录门禁（§五）、SIGTERM 优雅退出
    │   ├── config.js            # 配置读取 + fs.watch 热加载 .env（§3.5）；环境变量仅启动时兜底
    │   └── env-store.js         # .env 里 NCM_COOKIE 读写的单一实现（§3.7），服务与脚本共用
    ├── scripts/                 # 运维脚本（node 直接跑，或被 npm scripts / bat 调用）
    │   ├── serve-player.js      # 播放器服务 8080：静态页 + /api 同源反代（§四）；API_BASE 环境变量可指上游
    │   ├── qr-login.js          # 命令行扫码登录（npm run qrlogin），成功自动写 .env（§5.2）
    │   ├── smoke-test.js        # 冒烟测试：串行打 7 个核心接口（npm run smoke，§十）
    │   ├── check-login-status.js# 登录态检查（npm run status），未登录以退出码 1 结束
    │   └── wait-ready.js        # 轮询 URL 直到返回 2xx（start-all.bat 的启动排序依赖，§7.1）
    ├── public/
    │   └── player.html          # 网页播放器：单文件无框架，登录弹层 + 搜索/播放/歌词（§4.4）
    ├── docs/
    │   ├── api-examples.md      # 接口调用示例（curl / PowerShell / Python）
    │   ├── cookie-guide.md      # Cookie 获取 / 更新 / 排错
    │   └── docker-guide.md      # Docker 环境修复记录 + 部署运维全步骤
    ├── Dockerfile               # 生产镜像：node:22-bookworm-slim，无 apt 步骤（§6.1）
    ├── docker-compose.yml       # 生产编排：API + 播放器双服务（共用镜像）、./.env bind mount、健康检查（§6.2）
    ├── docker-compose.dev.yml   # 开发叠加配置：源码挂载 + node --watch 热重载（§6.4）
    ├── start-all.bat            # 一键启动 API + 播放器 + 开浏览器（§7.1）
    ├── start.bat                # 只启动 API（首次运行自动 npm install、复制 .env）
    ├── stop.bat                 # 按端口反查 PID 杀 3000/8080（§7.2）
    ├── package.json             # 依赖清单与 npm scripts
    ├── package-lock.json        # 依赖锁定，npm ci 可复现安装的依据
    ├── .env.example             # 配置模板（首次运行被复制为 .env）
    ├── .env                     # 【运行时生成】实际配置含 Cookie——勿提交 git、勿打进镜像
    ├── .dockerignore            # 镜像构建排除清单（.env、node_modules、docs 等）
    ├── .gitignore               # git 排除清单（.env、node_modules、logs）
    ├── logs/                    # 【运行时生成】compose 的 /app/logs 挂载点
    └── node_modules/            # 【运行时生成】npm install / npm ci 产物
```

**已删除的无用文件**（2026-09-22 清理）：

| 删除项 | 原因 |
| --- | --- |
| `.env.bak-json-pollution` | 修 .env 污染时的临时备份，Cookie 与现 .env 完全一致，冗余且多存一份明文凭证 |
| `src/routes/`（空目录） | 从未有文件 |
| `package.json` 的 `dotenv` 依赖 | 代码从未 `require('dotenv')`，上游包自带嵌套版 |
| Dockerfile 的 apt 步骤（tzdata/curl） | 基础镜像自带 tzdata；健康检查用 `node fetch` 不需要 curl |

## 三、API 服务的双层架构（核心设计）

[src/index.js](netease-api-windows/src/index.js) 是整个系统的中枢，采用**双层结构**：

```js
const internalPort = await getFreePort()                     // ① 探测真实空闲端口
const ncmApp = await serveNcmApi({ port: internalPort, host: '127.0.0.1' })  // ② 内层
const front = express()                                      // ③ 外层
front.get('/auth/status', ...)                               // ④ 登录门禁（必须在 Cookie 注入之前）
front.get('/auth/qr/create', ...)                            //    同上
front.get('/auth/qr/check', ...)                             //    同上
front.post('/auth/logout', ...)                              //    同上
front.use(cookie 注入中间件)                                  // ⑤
front.get('/health', ...)                                    // ⑥
front.use((req, res) => ncmApp(req, res))                    // ⑦ 进程内直调
front.listen(config.port, config.host)                       // ⑧ 对外监听
```

### 3.1 为什么要包一层，而不是直接用上游包？

上游包 `@neteasecloudmusicapienhanced/api` 的 Cookie 需要在**每个请求**的 query 或 header 里单独带，没有"全局默认 Cookie"概念。包一层 Express 后：

- 请求方（播放器、脚本、下载器）**不需要关心 Cookie**——没带 Cookie 的请求由外层中间件自动补上 `.env` 里的 `NCM_COOKIE`
- 上游包升级时只改一行依赖版本号，本项目逻辑零改动

### 3.2 进程内直调，而非 HTTP 转发

外层转发普通请求时**没有**发起二次 HTTP 请求，而是直接以函数方式调用内层 app：

```js
front.use((req, res) => ncmApp(req, res))
```

原理：Express 应用本身就是一个 `(req, res) => void` 处理器。外层把自己的 req/res 对象直接交给内层处理，省掉了 localhost 网络往返的开销，也避免了转发时的 header 处理坑。

**例外：`/auth/*` 与 `/health` 不走直调，而用 `callUpstream()` 发起一次极短的本地 HTTP 调用**：

```js
async function callUpstream(path, withCookie = false) {
  const headers = withCookie && config.cookie ? { cookie: config.cookie } : {}
  const res = await fetch(`http://127.0.0.1:${internalPort}${path}`, { headers })
  return { json: await res.json().catch(() => null), res }
}
```

原因有两点：
1. **要读响应头。** 登录接口的 Cookie 藏在 `Set-Cookie` 响应头里，`fetch` 能拿到完整响应对象，从而调用 `res.headers.getSetCookie()`；而直调模式下无法在同一处拦截上游响应头。
2. **要精确控制"带/不带 Cookie"。** `withCookie` 参数让调用方自己决定——查登录态要带，扫码流程绝不能带（见 §3.3）。

### 3.3 `/auth/*` 必须注册在 Cookie 注入中间件之前（关键顺序）

这是实现登录时踩到的坑：Express 中间件**按注册顺序**执行。如果 `/auth/*` 写在 Cookie 注入中间件之后，扫码请求会先被补上 `.env` 里的**旧 Cookie**（多半已失效），带着这个陈旧身份去 `login/qr/check`，新登录态建不起来。

因此代码里这四个登录路由被刻意前置，并用注释标注了原因。

### 3.4 随机空闲端口探测（getFreePort）

内层服务只监听 `127.0.0.1`（回环地址），外部网络无法触达，作为安全边界。端口通过一个探测技巧获得：

```js
srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(...) })
```

`listen(0)` 让操作系统内核从临时端口区间分配一个真实空闲端口，读出端口号后立刻关闭归还。

**为什么不能直接把 `port: 0` 传给 serveNcmApi？** 因为上游包把 `0` 视为"未设置"，会回落到默认 3000——那样内层就会和外层抢同一个端口。这是阅读上游源码后确认的坑。

### 3.5 Cookie 热加载（fs.watch）

[src/config.js](netease-api-windows/src/config.js) 用 `fs.watch` 监听 `.env` 文件变更，配合 200ms 去抖（编辑器保存常触发多次事件），Cookie 变化即时生效——**扫码登录后无需重启服务**。

```js
fs.watch(envStore.ENV_PATH, () => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    const next = readCookie()
    if (next === config.cookie) return      // 值没变就不刷
    config.cookie = next
  }, 200)
})
```

注意 `config.cookie` 是对象属性，外层中间件每次请求都读 `config.cookie` 的最新值，所以热加载天然对中间件可见。

**去抖带来的一处陷阱：** 服务端自己在 `/auth/qr/check` 里写完 `.env` 后，**不能只等 watcher 生效**——200ms 去抖窗口内若有别的请求进来，仍会读到旧 Cookie。所以写入后同步执行 `config.cookie = cookie` 直接更新内存。`fs.watch` 在这里的作用是兜住"用户在外部手改 `.env`"这种情况。

**环境变量只兜底启动。** `config.js` 启动时 `cookie = readCookie() || process.env.NCM_COOKIE || ''`，但 watcher **不做**这个回退——否则登出清空文件后，旧环境变量会把 Cookie 复活（见踩坑 14）。

### 3.6 .env 解析的正则陷阱

读取 Cookie 用正则提取（现集中在 [src/env-store.js](netease-api-windows/src/env-store.js)）：

```js
/^[ \t]*NCM_COOKIE[ \t]*=[ \t]*(.*)$/m
```

值两侧**只能用 `[ \t]`，不能用 `\s`**。`\s` 匹配换行符 `\n`，在 `m` 多行模式下 `$` 之前的 `\s*` 会跨行"吃掉"下一行内容——空 Cookie 会被误读成下一行的配置。这是实测踩过的 Bug。

### 3.7 .env 读写层：env-store.js

[src/env-store.js](netease-api-windows/src/env-store.js) 把 `.env` 里 `NCM_COOKIE` 的读写**单独抽出来**，供「服务进程」和「qr-login 脚本」共用：

```js
module.exports = { ENV_PATH, ensureEnv, readCookie, saveCookie, clearCookie }
```

设计要点：

- **为什么抽出来？** 之前服务和脚本各自实现了一遍"正则替换 `.env` 某行"的逻辑，结果 §3.6 那个 `\s` 跨行 Bug 在两处都埋了一份，修的时候要改两个地方。抽成单一实现后只改一处。
- **纯函数、零副作用。** 模块 `require` 进来时不监听文件、不读环境变量、不动磁盘——副作用都留给调用方显式触发。这样脚本里可以安全地按需调用，不会因为 import 就启动一个 watcher。
- **保留其余配置。** `saveCookie()` 只替换/追加 `NCM_COOKIE=` 那一行，`PORT`、`HOST` 等原样保留；文件不存在时用 `.env.example` 复制生成，模板也丢了就用内置兜底文本。
- **原地写入（writeFileSync）。** 不做"写临时文件再 rename"——这对 Docker 单文件 bind mount 至关重要：rename 会替换掉容器内的挂载点，导致容器看到的文件与宿主机脱钩。
- **`clearCookie()` 就是 `saveCookie('')`**，不额外维护"清空"分支。

## 四、网页播放器、同源代理与登录门禁

### 4.1 为什么需要 serve-player.js，而不是直接双击 html？

播放器页面在 8080 端口，API 在 3000 端口。浏览器有两种打开方式，都有问题：

- `file://` 直接打开：跨域请求 `fetch('http://localhost:3000/...')` 受 CORS 限制
- 8080 端口打开再直连 3000：端口不同同样是跨域

解法：[scripts/serve-player.js](netease-api-windows/scripts/serve-player.js) 用 Node 原生 `http` 模块做了一个极简服务器：

- `/api/*` 开头的请求 → 用 `fetch` 转发到 `http://127.0.0.1:3000/*`，原样回传状态码和 body（**同源代理**）
- 其他请求 → 当静态文件服务，返回 `public/` 下的文件

对浏览器来说，页面和 API 都在 `localhost:8080` 同一个源下，CORS 问题根本不存在。连不上 API 时代理返回 502 + 中文错误 JSON。

### 4.2 代理必须支持 POST 与透传 Set-Cookie

最初代理只处理 GET（`fetch(API + path)` 不带 method），而**退出登录是 POST**——经代理转发会被当成 GET，方法丢失、请求失败。改成完整转发：

```js
let body = null
if (req.method !== 'GET' && req.method !== 'HEAD') {
  const chunks = []
  for await (const c of req) chunks.push(c)      // 读原始请求体
  body = chunks.length ? Buffer.concat(chunks) : null
}
const upstream = await fetch(API + req.url.slice(4), {
  method: req.method, body,
  headers: body ? { 'content-type': req.headers['content-type'] || 'application/json' } : {},
})
// Set-Cookie 必须透传，否则登录态相关响应到不了浏览器
const setCookie = upstream.headers.getSetCookie?.() || []
if (setCookie.length) headers['set-cookie'] = setCookie
```

双保险：服务端登录成功时**同时**把 Cookie 写进 `.env`（持久化，重启也在）并通过 `Set-Cookie` 回传（会话级），所以即使某一环受限也不影响主流程。

### 4.3 目录穿越防护

静态文件处理有一行关键代码：

```js
const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[\\/])+/, ''))
```

`path.normalize` 规整路径后，再剥离开头的 `../`，防止 `GET /../.env` 之类的请求读到 `public/` 目录外的敏感文件。

### 4.4 player.html：登录与播放同页

[public/player.html](netease-api-windows/public/player.html) 是无框架单文件应用（约 18KB），**打开页面即完成"判断登录态 → 决定是否弹登录框"**，无需再开终端敲命令。要点：

**页面加载后的分支**（`refreshAuth()`）：

| 服务返回的 `reason` | 含义 | 页面行为 |
| --- | --- | --- |
| `ok` | 已登录 | 顶栏显示头像+昵称，不弹窗 |
| `anonymous` | 从未配置 Cookie | 弹「登录网易云账号」，可扫码或**跳过仅试听** |
| `expired` | 配了 Cookie 但服务端不认 | 弹「登录态已失效」提示，引导重新扫码或跳过 |
| `unreachable` | 连不上 API | 顶栏显示"服务未启动"+ 黄条提示先启服务 |

- **登录弹层 `#mask`**：内含二维码区、状态文字、两个按钮（扫码登录 / 跳过，仅试听）。跳过不写任何配置，只关弹层并显示"当前为游客模式"黄条；顶部保留「登录」入口随时可再进。
- **二维码轮询**（1.5s 间隔）对应上游四种状态码：`801` 等待扫码 / `802` 已扫待确认 / `803` 成功（显示昵称并 900ms 后自动关窗）/ `800` 已过期（自动换一张新码，但**只自动换一次**，用 `expiredOnce` 防止无限重取）。
- **双重超时保护**：接口返回 `expiresMs = 5min`，前端另设 `deadline` 独立判断，避免接口没返回状态码时轮询无限跑。
- **退出登录**：顶栏按钮改绑为 POST `/api/auth/logout`，服务端清空 `.env` 里的 Cookie。
- 所有 API 调用走 `/api` 前缀（同源代理）；播放链接用 `/song/url?id=xxx&level=exhigh`；渲染歌曲名/歌手前经 `esc()` 转义 `&<>"` 防 XSS，歌词用 `textContent` 赋值天然安全。

## 五、两条登录链路

系统同时提供**网页扫码**与**命令行扫码**两条路径，底层走的是同一套上游接口，区别只在交互方式。

### 5.1 网页链路（推荐）：`/auth/*` 四接口

| 接口 | 方法 | 作用 |
| --- | --- | --- |
| `/auth/status` | GET | 返回 `{ loggedIn, profile, cookieConfigured, reason }`；`reason` 是页面分支依据（ok / anonymous / expired / unreachable） |
| `/auth/qr/create` | GET | 内部串行调 `/login/qr/key` → `/login/qr/create?qrimg=true`，返回 `{ key, qrimg(base64 dataURL), qrurl, expiresMs }` |
| `/auth/qr/check?key=` | GET | 轮询扫码结果；`803` 时提取 Cookie → 写 `.env` → 立即回读 `/login/status` 拿昵称一并返回 |
| `/auth/logout` | POST | 清空 `.env` 与内存中的 Cookie |

**`expired` 是怎么判断的？** 一句话：`reason = p ? 'ok' : config.cookie ? 'expired' : 'anonymous'`——"配了 Cookie 但 `/login/status` 拿不到 profile"即视为登录态失效（改过密码、换设备、太久没登录都会这样）。

**二维码图片怎么来的？** 没有引任何二维码库。上游 `/login/qr/create` 支持 `qrimg=true`，直接返回 PNG 的 base64 data URL，前端 `<img src>` 即可显示，**零新增依赖**；命令行链路则用 `qrcode-terminal` 在终端画字符二维码。

### 5.2 命令行链路：`npm run qrlogin`

[scripts/qr-login.js](netease-api-windows/scripts/qr-login.js) 是等价的终端版本：

```
/login/qr/key     → 拿 unikey
/login/qr/create  → 拿 qrurl，qrcode-terminal 在终端画二维码
/login/qr/check   → 1.5s 间隔轮询，四种状态码：
                     800 已过期 → 递归重取
                     801 等待扫码
                     802 已扫待确认
                     803 成功 → 提取 Set-Cookie
```

登录成功后：

1. 从响应头提取 Cookie：`check.headers.getSetCookie()`（Node 19.7+ 的 undici API，普通 `headers.get('set-cookie')` 只能拿到合并后的一条，会丢字段），取每个 cookie 的 `名=值` 部分用 `; ` 拼接
2. `envStore.saveCookie()` 写入 `.env`（与网页链路**共用同一实现**）
3. `fs.watch` 热加载立即生效，并顺手调 `/login/status` 打印昵称确认

## 六、容器化部署（已跑通：容器 Up healthy，冒烟 7/7）

### 6.1 Dockerfile 的优化点

[Dockerfile](netease-api-windows/Dockerfile)（`node:22-bookworm-slim`）：

- **层缓存**：先只 `COPY package.json package-lock.json` 再 `npm ci`，最后才 `COPY . .`——改业务代码不会触发依赖重装
- `npm ci --omit=dev`（而非 `npm install`）：严格按 lock 文件安装，保证可复现
- **HEALTHCHECK**：`node -e "fetch(.../health)..."` 每 30s 探活，用 Node 自带 fetch——镜像里**不装 curl**
- 时区固化 `Asia/Shanghai`：基础镜像实测**自带 tzdata**，只需 `ln -snf` 软链，整个 apt 步骤已删除（顺带绕开 deb.debian.org 被 DNS 污染的 502 问题）
- npm 源切 `registry.npmmirror.com` 加速构建

### 6.2 compose 双文件策略

- [docker-compose.yml](netease-api-windows/docker-compose.yml)（生产）：**双服务共用同一镜像**（compose 只构建一次）——`netease-api` 跑 `node src/index.js`，`netease-player` 以 `command: node scripts/serve-player.js` 覆盖启动命令；两者都是 `restart: unless-stopped`。播放器经 `depends_on: service_healthy` 等 API 健康后再启动
- 关键网络细节：播放器代理的上游由 `API_BASE=http://netease-api:3000` 注入——**容器内 `127.0.0.1` 指向容器自己**，跨容器必须用 compose 服务名（服务名即内部 DNS 域名）
- API 服务另有：宿主端口 `${PORT:-3000}` 映射容器 3000、**bind mount `./.env:/app/.env`**——容器与宿主机共用同一份 .env，容器内扫码登录直接写回宿主机文件，重建不丢登录态；另保留 `env_file: .env` 注入环境变量作启动兜底。播放器不读 Cookie，无需挂载 .env
- [docker-compose.dev.yml](netease-api-windows/docker-compose.dev.yml)（开发，叠加使用）：源码整体挂载 `.:/app` + `npm run dev`（`node --watch`）实现热重载；关键细节是匿名卷 `- /app/node_modules`——**保住容器内 Linux 版的 node_modules，不被宿主机 Windows 版的覆盖**。播放器无第三方依赖，dev 里只挂源码即可让 player.html 改动即时生效

改 Cookie：`docker compose restart` 即可；改代码：`docker compose up -d --build`。

### 6.3 当前环境状态（2026-09-22 已修复并跑通）

**Docker 环境已就绪并全部落在 D 盘**（修复过程见下方历史记录）：

- Docker Desktop **4.92.0.240144** → `D:\Program Files\Docker\`（新版扁平目录，无 `Docker\Docker` 嵌套）
- 引擎 **29.8.0** + Compose **v5.5.1**；数据目录 `D:\Docker\wsl`（`--wsl-default-data-root` 指定），C 盘零占用
- `hello-world` 全链路验证通过（拉镜像、建容器、运行均正常）
- 注意：安装前已打开的终端 PATH 不会自动刷新，`docker` 命令需开新终端使用

**历史问题（已解决）**：原 Docker Desktop 4.1.1（2021 年版）装在 C 盘且引擎从未启动（卡在许可协议页）。修复过程：官方源直连被重置 → 经用户代理（7890）下载新版安装包 → 卸载 4.1.1 并清理 C 盘全部残留（约 2.6GB）→ `--installation-dir` + `--wsl-default-data-root` 装到 D 盘。完整步骤与运维命令见 [docs/docker-guide.md](netease-api-windows/docs/docker-guide.md)。

**项目容器已跑通**（2026-09-22）：`docker compose up -d --build` 成功，`netease-api` Up (healthy)，冒烟 7/7 通过，容器内 `/login/status` 登录态正常。过程中解决了两个网络坑：

1. **docker.io 直连被 DNS 污染**（解析到 104.244.x.x，拉层卡 0B/超时），且 **BuildKit 构建不走系统代理**（`docker info` 里的 `http.docker.internal:3128` 只对引擎部分路径生效）——最终方案是 `C:\Users\xing\.docker\daemon.json` 配 `registry-mirrors`（daocloud、1ms），重启 Docker Desktop 后生效。
2. **容器内 `cookieConfigured: false`**：`.dockerignore` 排除了 `.env`（不该打进镜像），而 `config.js` 只读文件不读环境变量 → compose 的 `env_file` 白注了。修复双管齐下：compose 加 bind mount `./.env:/app/.env`（主链路，登录写回宿主机），`config.js` 启动时增加 `process.env.NCM_COOKIE` 兜底（watcher 不兜底，否则登出清空文件后会被旧环境变量复活）。

日常仍以 `start-all.bat` 本机直跑为主；容器与直跑**不能同时用**（都抢 3000），切换前先停另一边。

**管理容器只认 `netease-api`**：在 Docker Desktop 的 Images 页点镜像的 Run 按钮会生成随机名容器（无端口映射，纯浪费），已踩过。正确入口是 Containers 页的 `netease-api` 或终端 `docker compose` 命令。

### 6.4 开发模式（容器内改代码立即生效）

```
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

退出开发模式回到生产：`docker compose up -d --build`。

## 七、启动编排与进程管理

### 7.1 start-all.bat 的启动时序

[start-all.bat](netease-api-windows/start-all.bat) 解决的是"两个进程有依赖顺序"的问题：

```
① start /min cmd /c "node src\index.js"        → 新最小化窗口起 API（不阻塞本窗口）
② node scripts\wait-ready.js .../health 30      → 轮询等 API 就绪，最多 30s
③ start /min cmd /c "node scripts\serve-player.js" → 起播放器
④ start "" "http://localhost:8080"              → 打开默认浏览器
⑤ timeout /t 8                                  → 8 秒后本窗口自动关闭
```

[scripts/wait-ready.js](netease-api-windows/scripts/wait-ready.js) 的就绪探测：每 500ms 发一次请求（单次 2s `AbortController` 超时），拿到 2xx 就以退出码 0 结束，超时退出码 1。bat 用 `if errorlevel 1` 接住超时并给出提示——避免"播放器先开了但 API 没起来，页面报连不上"的困惑。

### 7.2 stop.bat 按端口杀进程

[stop.bat](netease-api-windows/stop.bat) 不记 PID 文件，而是**现查现杀**：

```bat
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do taskkill /PID %%p /F
```

从 `netstat -ano` 输出里按"监听某端口"反查 PID（第 5 列），3000 和 8080 各扫一遍。好处是：即使服务是在别的窗口/别的终端里启动的，也能准确找到并停掉。

**注意：容器模式（3000/8080 被容器占用）时不要跑 stop.bat**——那时监听端口的是 Docker 的端口转发进程，强杀会搞坏 Docker 网络。容器该用 `docker compose stop` 停。

### 7.3 bat 文件的编码原理（重要踩坑）

三个 bat 都必须是**纯 ASCII 或 GBK 编码**，不能是 UTF-8。原因：

cmd 读取批处理文件时按**系统 ANSI 代码页（中文 Windows 为 936/GBK）**逐字节解析。文件里写 `chcp 65001` 只能改变**输出**代码页，改变不了解析行为——cmd 把 65001 当单字节代码页处理，而 UTF-8 编码的中文字符是 3 个字节，其后两个字节（0x80~0xBF 区间）可能恰好等于 ASCII 特殊字符（`"`、`(`、`)`、`>`、`&`），导致：

- 引号配对被打乱 → `copy ".env.example" ".env"` 被截断成乱码片段，报"不是内部或外部命令"
- `cd /d "%~dp0"` 失效 → 后续 `node src\index.js` 在错误的目录执行 → `MODULE_NOT_FOUND`

**结论：bat 里要么全英文（纯 ASCII），要么用 GBK/ANSI 编码保存中文。** 本项目选择了前者。

## 八、测试流程

> 所有命令都在 `netease-api-windows/` 目录内执行。两种形态（本机直跑 / 容器）命令相同，区别只是 3000 背后是谁。

### 8.1 快速自检（约 1 分钟，日常用这个）

```bash
# ① 服务在不在：本机直跑看进程，容器看状态
docker compose ps                       # 容器模式：应显示 Up ... (healthy)
netstat -ano | findstr ":3000 "         # 本机直跑：应有 LISTENING

# ② 健康检查：应返回 "status":"ok","cookieConfigured":true
curl http://localhost:3000/health

# ③ 冒烟测试：7 个核心接口应全 PASS
npm run smoke

# ④ 登录态：应打印昵称/userId/vipType
npm run status
```

四项全过 = 服务正常，到此为止。

### 8.2 接口层测试案例（冒烟测试覆盖的 7 项）

`npm run smoke` 串行执行以下案例，全部 HTTP 200 + 业务 `code=200` 才算过：

| # | 接口 | 案例 | 通过判定 |
| --- | --- | --- | --- |
| 1 | `/health` | 健康检查 | `status=ok` |
| 2 | `/search?keywords=周杰伦&type=1&limit=3` | 搜索单曲 | 命中 ≥1 首 |
| 3 | `/search?keywords=热歌&type=1000&limit=3` | 搜索歌单 | 命中 ≥1 个 |
| 4 | `/song/detail?ids=347230` | 歌曲详情（海阔天空） | 返回该曲信息 |
| 5 | `/lyric?id=347230` | 歌词 | 歌词长度 >0 |
| 6 | `/playlist/detail?id=24381616` | 歌单详情 | 返回曲目列表 |
| 7 | `/login/status` | 登录状态 | 接口可调通（未登录也算通） |

手动单测某个接口的例子：

```bash
curl "http://localhost:3000/search?keywords=海阔天空&type=1&limit=5"
curl "http://localhost:3000/song/url?id=347230&level=exhigh"   # 播放链接
curl "http://localhost:3000/auth/status"                       # 登录三态
```

### 8.3 播放器端到端案例

```bash
npm run player        # 起 8080（依赖 3000 已在跑）
```

浏览器开 `http://localhost:8080`，逐项验证：

| 步骤 | 预期 |
| --- | --- |
| 页面打开 | 右上角显示「已登录」+ 头像昵称，**不弹**登录框 |
| 搜「周杰伦」回车 | 列表出 20 条，含歌名/歌手/时长 |
| 点任意一首 | 播放器出现并出声，**完整歌曲**（非 45 秒试听） |
| 往下滚动 | 歌词卡出现，有歌词文本 |
| 点「热门歌单」 | 加载内置歌单（1000+ 首） |
| 停掉 3000 再刷新页面 | 顶栏显示"服务未启动" + 黄条提示（异常分支） |

### 8.4 登录/登出链路案例（验 .env 热加载）

| 步骤 | 预期 |
| --- | --- |
| 右上角点「退出登录」 | 标签变「游客模式」；`.env` 里 `NCM_COOKIE=` 被清空 |
| 再点任意歌播放 | 只有 30~45 秒试听片段 |
| `curl localhost:3000/health` | `cookieConfigured:false`（**无需重启即生效**） |
| 点「登录」→「扫码登录」 | 出现二维码，网易云 App 扫码确认 |
| 登录成功 | 弹层自动关闭，头像昵称恢复；`.env` 自动写回新 Cookie；`/health` 变回 `cookieConfigured:true`（全程不重启） |
| 命令行链路 `npm run qrlogin` | 终端画二维码，扫码后打印昵称；效果与网页链路一致 |
| 失效分支：手改 `.env` 把 Cookie 改成乱码，刷新页面 | 弹「登录态已失效」提示（等 200ms 去抖后生效） |

### 8.5 容器模式专项案例

```bash
# 双服务都健康：netease-api 与 netease-player 均 Up (healthy)
docker compose ps

# 播放器容器端到端：页面 + 经代理打 API + 登录态
curl -o /dev/null -w "%{http_code}\n" http://localhost:8080/
curl http://localhost:8080/api/health          # 应返回与 3000 直连相同的 JSON
curl http://localhost:8080/api/auth/status     # 应显示 loggedIn:true

# 持久化：重启容器登录态不丢（.env bind mount）
docker compose restart
sleep 10 && curl http://localhost:3000/health     # cookieConfigured 仍为 true

# 优雅停机：应 1~2 秒停掉，退出码 0（不是 137）
time docker compose stop
docker inspect netease-api --format "{{.State.ExitCode}}"   # 应输出 0
docker compose start

# 登录写回：容器内网页扫码后，宿主机的 .env 应直接变化
```

### 8.6 模式切换案例（验端口不冲突）

```bash
# 本机 → 容器
stop.bat && docker compose up -d && curl http://localhost:3000/health

# 容器 → 本机
docker compose stop && start-all.bat             # 应能正常起 3000+8080 并开浏览器
```

**判定标准**：8.3、8.4 全过 = 功能完好；8.5 全过 = 容器化达标。

## 九、命令速查

| 场景 | 命令 | 说明 |
| --- | --- | --- |
| 本机一键启动 | `start-all.bat` | API + 播放器 + 自动开浏览器 |
| 本机只起 API | `start.bat` | 首次运行自动 npm install |
| 本机停止 | `stop.bat` | 按端口杀 3000/8080 |
| 起播放器（本机） | `npm run player` | 8080，依赖 3000 已在跑；**容器模式不需要**（8080 由 netease-player 容器提供） |
| 冒烟测试 | `npm run smoke` | 7 接口，有失败则非零退出 |
| 登录态检查 | `npm run status` | 未登录以退出码 1 结束 |
| 命令行扫码 | `npm run qrlogin` | 自动写 .env，热加载生效 |
| 开发模式 | `npm run dev` | `node --watch`，改代码自动重启 |
| 容器启动 | `docker compose up -d` | 首次/改代码后加 `--build` |
| 容器状态/日志 | `docker compose ps` / `docker compose logs -f` | — |
| 容器停止/启动 | `docker compose stop` / `docker compose start` | stop 不删容器 |
| 容器彻底移除 | `docker compose down` | 镜像还在；`--rmi local` 连镜像一起删 |
| 容器排错 | `docker compose exec netease-api sh` | 进容器 shell |
| 切换形态 | 先停一边再起另一边 | 3000 不能同时被两家占用 |

**终端注意**：装 Docker Desktop 之前打开的终端没有 `docker` 命令（PATH 不刷新），重开终端即可。bash 里可临时 `export PATH="/d/Program Files/Docker/resources/bin:$PATH"`。

## 十、质量保障脚本

| 脚本 | 原理 |
| --- | --- |
| `npm run smoke`（[smoke-test.js](netease-api-windows/scripts/smoke-test.js)） | 串行打 7 个核心接口，校验 HTTP 200 + 业务 `code=200`，附耗时与内容摘要（命中几首、歌词长度等），有失败则以非零码退出，可接入 CI |
| `npm run status`（[check-login-status.js](netease-api-windows/scripts/check-login-status.js)） | 调 `/login/status` 解析 `data.profile`，打印昵称/userId/vipType；未登录时给出处理步骤并以退出码 1 结束 |
| `/health`（服务自带） | 返回 `cookieConfigured`（布尔，不泄露 Cookie 本体）、内层端口、`watchingEnv`（.env 监听是否可用）、uptime、Node 版本 |

## 十一、技术栈与原理速查

| 技术点 | 用在哪里 | 原理/说明 |
| --- | --- | --- |
| weapi/eapi 加密 | 上游包内部 | 网易云接口请求的 AES+RSA 加密与签名，由上游包实现，本项目不重复造轮子 |
| Express 中间件顺序 | 登录门禁 vs Cookie 注入 | 按注册顺序执行；`/auth/*` 必须在注入前，否则扫码会带旧 Cookie |
| Express 中间件 | Cookie 注入 | 请求对象在管线中可变，无 cookie 头时补写后再放行 |
| Express app 即 handler | 双层直调 | `app(req, res)` 直接调用，无二次 HTTP |
| 本地短链 `callUpstream` | `/auth/*`、`/health` | 需要读响应头（Set-Cookie）且要按需带 Cookie，故走一次 127.0.0.1 HTTP |
| 三态判定 | `/auth/status` | `profile` 有无 × `cookie` 有无 → ok / expired / anonymous |
| `listen(0)` | 内层端口 | 内核分配临时端口，读回后立即释放 |
| `fs.watch` + 去抖 | Cookie 热加载 | 编辑器保存触发多次事件，200ms 合并为一次；自写场景需同步改内存 |
| 原生 `fetch`（undici） | 各脚本 | Node 18+ 内置；`headers.getSetCookie()` 取完整多值 Set-Cookie |
| base64 data URL 二维码 | 网页登录 | 上游 `qrimg=true` 直接给 PNG，`<img src>` 即可，无需二维码库 |
| 同源反向代理 | 播放器 | 页面与 API 同端口，绕开浏览器 CORS；需支持 POST 与透传 Set-Cookie |
| `AbortController` | wait-ready | 单次请求 2s 超时控制 |
| `netstat` 反查 PID | stop.bat | 不依赖 PID 文件，按端口定位进程 |
| cmd 代码页 | bat 编码 | 65001 被当单字节页解析，UTF-8 中文必坏 → 纯 ASCII 或 GBK |
| PID 1 信号屏蔽 | 容器优雅退出 | Linux 对 PID 1 无默认信号处置，Node 不装 handler 会忽略 SIGTERM → 装 handler 后 `server.close` 退出码 0 |
| Docker 层缓存 | Dockerfile | 依赖清单与源码分层 COPY |
| 匿名卷 | compose dev | 防止宿主机 node_modules 覆盖容器内 Linux 依赖 |
| 单文件 bind mount | compose 生产 | 容器与宿主共用 `.env`，容器内写入直落宿主机（须原地写，不能 rename）；反向（宿主改→容器 fs.watch）在 Docker Desktop 下不触发，需 restart |
| registry-mirrors | `daemon.json` | docker.io 被 DNS 污染时走国内镜像站；BuildKit 不吃系统代理，只能靠它 |
| compose 服务名 DNS | 容器间通信 | 同一 compose 网络内服务名即域名；`127.0.0.1` 在容器内指自己，跨容器必须用服务名 |
| 单镜像多服务 | compose 双容器 | 同 `image` + 不同 `command` 覆盖启动命令，compose 只构建一次 |

## 十二、踩坑记录（实测确认）

1. **bat 文件 UTF-8 编码 + 中文** → cmd 解析错乱，命令被截断、`cd` 失效、`MODULE_NOT_FOUND`。修复：bat 内容改纯英文。（详见 §7.3）
2. **`EADDRINUSE: 0.0.0.0:3000`** → 重复启动第二个实例；也可能旧进程僵死（占着端口但不响应请求）。处理：先 `stop.bat`（本机直跑时）或 `docker compose stop`（容器时）再启动。
3. **`serveNcmApi({port: 0})` 不生效** → 上游把 0 当未设置回落到 3000，内外层抢端口。修复：先 `listen(0)` 探测真实空闲端口。（详见 §3.4）
4. **.env 正则用 `\s*`** → `\s` 跨行匹配，空 Cookie 读到下一行内容。修复：改 `[ \t]*`，并把读写收敛到 `env-store.js` 单一实现。（详见 §3.6、§3.7）
5. **`/song/url/v1` 在 v4.40.1 上 404** → 正确路径是 `/song/url`，上游文档与实现不同步。
6. **未登录只能试听 30~45 秒** → 网易云服务端限制，非 Bug；扫码登录后得完整链接。
7. **`/auth/*` 写在 Cookie 注入中间件之后** → 扫码请求带着失效的旧 Cookie 去建新登录态，登录失败。修复：登录路由前置，并用 `withCookie` 参数显式控制。（详见 §3.3）
8. **代理只转发 GET** → 退出登录的 POST 经代理方法丢失。修复：代理读原始请求体并透传 `method` 与 `Set-Cookie`。（详见 §4.2）
9. **写完 `.env` 后立刻被别的请求读走旧值** → `fs.watch` 有 200ms 去抖窗口。修复：服务端写入后同步更新内存中的 `config.cookie`，不单纯依赖 watcher。（详见 §3.5）
10. **Docker 引擎起不来但并非故障** → 日志 `Showing new-license`，属于等待用户接受许可协议。（详见 §6.3）
11. **BuildKit 构建拉镜像超时，挂系统代理无效** → docker.io 被 DNS 污染（104.244.x.x），且 BuildKit 不走系统代理。修复：`daemon.json` 配 `registry-mirrors` 后重启 Docker Desktop。（详见 §6.3）
12. **容器里 `cookieConfigured: false` 但宿主机正常** → `.dockerignore` 排除了 `.env`，而代码只从文件读 Cookie。修复：bind mount `./.env:/app/.env` + 启动时 `process.env.NCM_COOKIE` 兜底。（详见 §6.3）
13. **构建时 `apt-get update` 报 502** → deb.debian.org 被 DNS 污染。修复：发现基础镜像自带 tzdata、健康检查用 node fetch，整个 apt 步骤直接删除。（详见 §6.1）
14. **`env` 兜底写进 watcher 会导致登出失效** → 登出是清空文件，若 watcher 也回退到环境变量，旧 Cookie 会复活。规则：**环境变量只在启动时兜底，热加载只认文件**。（详见 §3.5）
15. **容器退出码 137 且 `docker stop` 卡 10 秒** → Node 是容器 PID 1，Linux 对 PID 1 无默认信号处置，SIGTERM 被忽略，只能等超时 SIGKILL。修复：`src/index.js` 装 SIGTERM/SIGINT handler（`server.close` + 3s 兜底退出），stop 约 1 秒、退出码 0。
16. **Docker Desktop Images 页点 Run** → 每次生成一个随机名容器（无端口映射、无 .env 挂载），纯属垃圾容器。规则：只通过 Containers 页的 `netease-api` 或 `docker compose` 管理。（详见 §6.3）
17. **容器化播放器后代理 502** → 容器内 `127.0.0.1` 指向容器**自己**，不是宿主机也不是隔壁容器。修复：`serve-player.js` 支持 `API_BASE` 环境变量，compose 注入 `http://netease-api:3000`（服务名即内部 DNS）。（详见 §6.2）

## 十三、合规说明

本项目只做接口中转，不解密、不缓存、不分发任何音乐文件。上游包的"解锁灰色歌曲"功能（`ENABLE_GENERAL_UNBLOCK`）默认未开启也不会开启——那是绕过版权保护的功能，不在本项目目标范围内。仅供个人学习与合法用途。
