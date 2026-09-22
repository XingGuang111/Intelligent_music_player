'use strict'

const fs = require('fs')
const envStore = require('./env-store')

// Cookie 的读写统一走 env-store，服务与 qr-login 脚本共用一套实现
const { readCookie, ensureEnv } = envStore

ensureEnv()

const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',
  // .env 文件是权威来源；环境变量只在启动时兜底（如 docker run -e NCM_COOKIE=…）。
  // 注意：热加载 watcher 不做这个兜底，否则「登出清空文件」会被旧环境变量复活。
  cookie: readCookie() || process.env.NCM_COOKIE || '',
}

// ---- 监听 .env 变化，扫码保存后无需重启服务 ----
let watcherOk = false
try {
  let timer = null
  fs.watch(envStore.ENV_PATH, () => {
    // 编辑器保存可能触发多次，去抖
    clearTimeout(timer)
    timer = setTimeout(() => {
      const next = readCookie()
      if (next === config.cookie) return
      config.cookie = next
      console.log(
        next
          ? '[netease-api] 检测到 .env 更新，Cookie 已生效（无需重启）'
          : '[netease-api] 检测到 .env 更新，Cookie 已清空',
      )
    }, 200)
  })
  watcherOk = true
} catch (err) {
  console.warn('[netease-api] 无法监听 .env，改 Cookie 后需手动重启：', err.message)
}

config.watchingEnv = watcherOk

module.exports = config
