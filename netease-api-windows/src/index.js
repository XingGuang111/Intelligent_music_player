'use strict'

const net = require('net')
const express = require('express')
const { serveNcmApi } = require('@neteasecloudmusicapienhanced/api')
const config = require('./config')
const envStore = require('./env-store')

/** 取一个真实空闲端口（serveNcmApi 把 port:0 视为未设置，会回落到 3000） */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

async function main() {
  const internalPort = await getFreePort()

  // ---- 内层：官方增强版 API，只监听回环地址，不直接对外 ----
  const ncmApp = await serveNcmApi({
    port: internalPort,
    host: '127.0.0.1',
    checkVersion: false,
  })

  const front = express()

  /** 直调内层接口（进程内，不走外网）；withCookie=true 时带上当前登录态 */
  async function callUpstream(path, withCookie = false) {
    const headers = withCookie && config.cookie ? { cookie: config.cookie } : {}
    const res = await fetch(`http://127.0.0.1:${internalPort}${path}`, { headers })
    const json = await res.json().catch(() => null)
    return { json, res }
  }

  // ===================== 登录相关 =====================
  // 必须注册在 Cookie 注入中间件之前：扫码过程不能带旧 Cookie，否则拿不到新登录态。

  /** 当前登录态 */
  front.get('/auth/status', async (_req, res) => {
    try {
      const { json } = await callUpstream(`/login/status?_=${Date.now()}`, true)
      const p = json?.data?.profile
      res.json({
        loggedIn: Boolean(p),
        profile: p ? { userId: p.userId, nickname: p.nickname, avatarUrl: p.avatarUrl } : null,
        cookieConfigured: Boolean(config.cookie),
        // 配了 Cookie 但服务端不认 → 多半是改过密码或长期未登录
        reason: p ? 'ok' : config.cookie ? 'expired' : 'anonymous',
      })
    } catch (err) {
      res
        .status(502)
        .json({ loggedIn: false, profile: null, cookieConfigured: Boolean(config.cookie), reason: 'unreachable', msg: err.message })
    }
  })

  /** 生成一张新的登录二维码，返回可直接塞进 <img src> 的 base64 data URL */
  front.get('/auth/qr/create', async (_req, res) => {
    try {
      const k = await callUpstream(`/login/qr/key?_=${Date.now()}`)
      const unikey = k.json?.data?.unikey
      if (!unikey) throw new Error('获取 unikey 失败')
      const c = await callUpstream(`/login/qr/create?key=${unikey}&qrimg=true&_=${Date.now()}`)
      res.json({
        key: unikey,
        qrimg: c.json?.data?.qrimg || '',
        qrurl: c.json?.data?.qrurl || `https://music.163.com/login?codekey=${unikey}`,
        expiresMs: 5 * 60 * 1000,
      })
    } catch (err) {
      res.status(502).json({ key: '', qrimg: '', msg: err.message })
    }
  })

  /** 轮询扫码结果；成功后自动写进 .env 并立即生效 */
  front.get('/auth/qr/check', async (req, res) => {
    const key = String(req.query.key || '')
    if (!key) return res.status(400).json({ code: -1, message: '缺少 key' })
    try {
      const { json, res: up } = await callUpstream(
        `/login/qr/check?key=${encodeURIComponent(key)}&_=${Date.now()}`,
      )
      const code = json?.code

      if (code !== 803) {
        // 800 已过期 / 801 等待扫码 / 802 已扫待确认
        return res.json({ code, message: json?.message || '' })
      }

      // 优先取响应头的 Set-Cookie，退回响应体里的 cookie 字段
      const setCookie = up.headers.getSetCookie?.() || []
      const cookie = setCookie.length
        ? setCookie.map((c) => c.split(';')[0].trim()).join('; ')
        : String(json?.cookie || '').trim()

      if (!cookie) {
        return res.json({ code, loggedIn: false, message: '登录成功但未取到 Cookie，请重试' })
      }

      envStore.saveCookie(cookie)
      config.cookie = cookie // 不等 watcher，本进程立刻生效
      console.log('[netease-api] 网页扫码登录成功，Cookie 已写入 .env')

      const st = await callUpstream(`/login/status?_=${Date.now()}`, true)
      const p = st.json?.data?.profile
      res.json({
        code,
        loggedIn: Boolean(p),
        profile: p ? { userId: p.userId, nickname: p.nickname, avatarUrl: p.avatarUrl } : null,
        message: p ? '登录成功' : 'Cookie 已保存，但未识别到账号',
      })
    } catch (err) {
      res.status(502).json({ code: -1, message: err.message })
    }
  })

  /** 退出登录：清空 .env 里的 Cookie */
  front.post('/auth/logout', (_req, res) => {
    envStore.clearCookie()
    config.cookie = ''
    res.json({ ok: true, loggedIn: false })
  })

  // ---- Cookie 注入网兜：调用方没带 Cookie 时，用 .env 里的 NCM_COOKIE ----
  front.use((req, _res, next) => {
    if (!req.headers.cookie && config.cookie) {
      req.headers.cookie = config.cookie
    }
    next()
  })

  front.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      cookieConfigured: Boolean(config.cookie),
      internalPort,
      watchingEnv: config.watchingEnv,
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
    })
  })

  // 其余请求全部交给内层 API 处理（进程内直调，无网络开销）
  front.use((req, res) => ncmApp(req, res))

  const server = front.listen(config.port, config.host, () => {
    console.log(
      `[netease-api] listening on http://${config.host}:${config.port}` +
        ` (internal ${internalPort}) | cookie: ${config.cookie ? 'configured' : 'none (public endpoints only)'}`,
    )
  })

  // 容器里本进程是 PID 1：不装 handler 时 SIGTERM 会被忽略，
  // docker stop 只能等 10 秒强杀，退出码变成难看的 137
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      console.log(`[netease-api] 收到 ${sig}，正在退出`)
      server.close(() => process.exit(0))
      setTimeout(() => process.exit(0), 3000).unref()
    })
  }
}

main().catch((err) => {
  console.error('[netease-api] failed to start:', err)
  process.exit(1)
})
