'use strict'

/**
 * 登录态检查脚本：判断 .env 里的 Cookie 是否仍然有效
 * 用法： node scripts/check-login-status.js [baseUrl]
 */

const BASE = process.argv[2] || process.env.API_BASE || 'http://127.0.0.1:3000'

;(async () => {
  let res
  try {
    res = await fetch(`${BASE}/login/status?_=${Date.now()}`)
  } catch (err) {
    console.error(`连接服务失败：${err.message}`)
    console.error(`请先确认服务已启动：${BASE}`)
    process.exit(1)
  }

  const j = await res.json()
  const p = j.data?.profile

  if (p) {
    console.log(`已登录：${p.nickname}  (userId=${p.userId}, vipType=${p.vipType})`)
  } else {
    console.log(`未登录（code=${j.code}）`)
    console.log('若 .env 里已配置 NCM_COOKIE 仍提示未登录，说明 Cookie 已过期。')
    console.log('处理：播放器页面点「登录」扫码，或执行 npm run qrlogin —— 自动写 .env，热加载免重启')
    process.exitCode = 1
  }
})()
