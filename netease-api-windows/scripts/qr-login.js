'use strict'

/**
 * 二维码登录：获取 key -> 终端打印二维码 -> 轮询扫码结果 -> 输出 Cookie
 * 用法： node scripts/qr-login.js [baseUrl]
 */

const qrcode = require('qrcode-terminal')
const envStore = require('../src/env-store')
const BASE = process.argv[2] || process.env.API_BASE || 'http://127.0.0.1:3000'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  // 1. 获取 key
  const keyRes = await fetch(`${BASE}/login/qr/key?_=${Date.now()}`)
  const keyJson = await keyRes.json()
  const unikey = keyJson.data?.unikey
  if (!unikey) throw new Error('获取 unikey 失败: ' + JSON.stringify(keyJson))

  // 2. 生成二维码内容并打印
  const qrRes = await fetch(`${BASE}/login/qr/create?key=${unikey}&qrimg=true&_=${Date.now()}`)
  const qrJson = await qrRes.json()
  const url = qrJson.data?.qrurl || `https://music.163.com/login?codekey=${unikey}`

  console.log('\n请用网易云音乐 App 扫描下面的二维码：\n')
  qrcode.generate(url, { small: true })

  // 3. 轮询扫码结果
  const deadline = Date.now() + 5 * 60 * 1000
  while (Date.now() < deadline) {
    await sleep(1500)
    const check = await fetch(`${BASE}/login/qr/check?key=${unikey}&_=${Date.now()}`)
    const j = await check.json()
    const code = j.code

    if (code === 800) {
      process.stdout.write('\r二维码已过期，正在重新获取...\n')
      return main()
    }
    if (code === 801) process.stdout.write('\r等待扫码...      ')
    else if (code === 802) process.stdout.write('\r已扫描，等待确认...')
    else if (code === 803) {
      const setCookie = check.headers.getSetCookie?.() || []
      const cookie = setCookie.map((c) => c.split(';')[0]).join('; ')

      if (!cookie) {
        console.log('\n\n登录成功，但没从响应头取到 Cookie。')
        console.log('请手动从浏览器复制后填进 .env 的 NCM_COOKIE。\n')
        return
      }

      envStore.saveCookie(cookie)
      console.log('\n\n登录成功！Cookie 已自动写入 .env 的 NCM_COOKIE。')
      console.log('服务会监听 .env 变化并自动生效，无需重启。\n')

      // 确认一下服务是否已生效
      try {
        const st = await fetch(`${BASE}/login/status?_=${Date.now()}`)
        const sj = await st.json()
        const p = sj.data?.profile
        console.log(p ? `校验通过：已登录为 ${p.nickname}\n` : '已保存，但服务暂未识别，稍等 1 秒再试 npm run status\n')
      } catch {
        console.log('（无法连接服务校验，请确认服务已启动）\n')
      }
      return
    }
  }
  console.log('\n\n超时（5 分钟），请重新运行本脚本。')
}

main().catch((e) => {
  console.error('登录失败:', e.message)
  process.exit(1)
})
