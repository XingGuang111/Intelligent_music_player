'use strict'

/**
 * 播放器静态服务：把 public/ 挂出去，并把 /api/* 反向代理到本地 API 服务。
 * 走同源代理是为了避开浏览器的跨域限制（file:// 或不同端口直连都可能被拦）。
 *
 * 用法： npm run player   （默认 http://localhost:8080）
 *
 * API_BASE 环境变量可改上游地址。容器里 127.0.0.1 指向容器自己，
 * 所以 compose 里会注入 API_BASE=http://netease-api:3000（服务名即域名）。
 */

const http = require('http')
const fs = require('fs')
const path = require('path')

const API = process.env.API_BASE || `http://127.0.0.1:${process.env.PORT || 3000}`
const PUBLIC_DIR = path.join(__dirname, '..', 'public')
const PORT = Number(process.env.PLAYER_PORT || 8080)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

const server = http.createServer(async (req, res) => {
  // ---- /api/* 反向代理到 API 服务 ----
  // 支持 GET/POST，透传请求体与 Set-Cookie，让网页登录流程走完整。
  if (req.url.startsWith('/api/')) {
    let body = null
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks = []
      for await (const c of req) chunks.push(c)
      body = chunks.length ? Buffer.concat(chunks) : null
    }
    try {
      const upstream = await fetch(API + req.url.slice(4), {
        method: req.method,
        headers: body ? { 'content-type': req.headers['content-type'] || 'application/json' } : {},
        body,
      })
      const buf = Buffer.from(await upstream.arrayBuffer())
      const headers = {
        'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      }
      // 登录态相关响应依赖 Set-Cookie，必须透传（服务端同时会写 .env，这里只是保险）
      const setCookie = upstream.headers.getSetCookie?.() || []
      if (setCookie.length) headers['set-cookie'] = setCookie
      res.writeHead(upstream.status, headers)
      res.end(buf)
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ code: 502, msg: `连不上 API 服务 ${API}：${err.message}` }))
    }
    return
  }

  // ---- 静态文件 ----
  const rel = req.url === '/' ? '/player.html' : req.url.split('?')[0]
  const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[\\/])+/, ''))

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('404 Not Found')
      return
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
    res.end(data)
  })
})

server.listen(PORT, () => {
  console.log(`播放器已启动: http://localhost:${PORT}`)
  console.log(`API 服务地址: ${API}`)
})
