# Cookie 管理指南

服务的登录态存在 `.env` 的 `NCM_COOKIE` 里。程序只负责在请求没带 Cookie 时用它兜底，不会自己去改账号状态。

**扫码成功后会自动写入 `.env`，并且服务会立刻感知，不用重启。**

## 0. 推荐：在播放器网页里扫

运行 `start-all.bat` 打开 `http://localhost:8080`，页面会自己判断登录态：

- **没配过 Cookie** → 弹出登录框，点「扫码登录」生成二维码，也可以点 **跳过，仅试听**
- **登录态失效**（改过密码、换设备、太久没用）→ 弹框提示「登录态已失效」，重新扫码即可恢复
- 扫码成功 → Cookie 自动写入 `.env` 并立即生效，右上角显示头像和昵称
- 想换号或退出 → 点右上角「退出登录」，`.env` 里的 Cookie 被清空，回到游客模式

背后的接口是 `/auth/status`、`/auth/qr/create`、`/auth/qr/check`、`/auth/logout`（见 README 的接口表）。

## 1. 获取 Cookie（二维码登录）

1. 确保服务已启动（`start-all.bat`，或容器模式 `docker compose up -d`）。
2. 在项目目录打开终端，执行：

   ```
   npm run qrlogin
   ```

3. 终端打印二维码，用**网易云音乐 App** 扫码并确认。
4. 成功后脚本自动把 Cookie 写进 `.env` 的 `NCM_COOKIE`，并立即校验一次登录态：

   ```
   登录成功！Cookie 已自动写入 .env 的 NCM_COOKIE。
   服务会监听 .env 变化并自动生效，无需重启。

   校验通过：已登录为 XXX
   ```

不用手动复制粘贴，也不用重启服务。

## 2. 检查 Cookie 是否有效

```
npm run status
```

- 输出 `已登录：xxx` → Cookie 有效。
- 输出 `未登录（code=xxx）` → Cookie 已过期或没配置，重新走第 1 步。

## 3. 过期后的处理

Cookie 过期没有固定周期，通常几周到几个月，取决于网易云的风控。过期时接口会返回 `code=301`（需要登录）或 `code=-462`。

处理只需两步：

```
npm run qrlogin        # 重新扫码，Cookie 自动写入 .env 并即时生效
npm run status         # 确认显示"已登录"
```

不需要重启服务、不需要清缓存、不需要重新构建。

> 原理：`src/config.js` 用 `fs.watch` 监听 `.env`，文件内容变化后（去抖 200ms）重新读取 `NCM_COOKIE`。
> 所以你**手动**编辑 `.env` 也一样即时生效。
>
> **容器模式例外**：「即时生效」指本机直跑。服务跑在 Docker 里时——**容器内**扫码登录会经 bind mount 写回宿主机 `.env`，容器自己立即生效；但反过来你在**宿主机**手改 `.env`，容器内的 `fs.watch` 感知不到（Docker Desktop 挂载的已知限制），要 `docker compose restart` 才生效。

## 4. 调用方如何传 Cookie

两种方式，任选：

- 依赖 `.env` 兜底：调用方什么都不传，服务自动注入 `NCM_COOKIE`。
- 调用方自己传（适合多个账号共用同一服务）：
  - HTTP 头：`Cookie: MUSIC_U=xxx; __csrf=xxx`
  - 或 URL 参数：`?cookie=MUSIC_U%3Dxxx%3B%20__csrf%3Dxxx`（需 URL 编码）

调用方显式传入时，优先级高于 `.env` 的兜底值。

## 5. 安全提醒

- `.env` 已在 `.gitignore` 中，**不要提交到版本控制**。
- Cookie 等同于账号凭证，泄露即可被他人以你的身份操作账号，请勿分享给他人或贴到公开场合。
- 如需彻底注销，在 App 里退出登录后，把 `.env` 里的 `NCM_COOKIE` 清空。
