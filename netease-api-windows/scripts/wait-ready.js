#!/usr/bin/env node
/**
 * wait-ready.js — 轮询某个 URL 直到返回 2xx，或超时。
 *
 * 用法: node scripts/wait-ready.js <url> [timeoutSeconds]
 * 退出码: 0 = 就绪, 1 = 超时
 */
const url = process.argv[2]
const timeoutSec = Number(process.argv[3] || 30)

if (!url) {
  console.error('用法: node scripts/wait-ready.js <url> [timeoutSeconds]')
  process.exit(2)
}

const deadline = Date.now() + timeoutSec * 1000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 2000)
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timer)
      if (res.ok) {
        console.log(`ready: ${url} -> HTTP ${res.status}`)
        process.exit(0)
      }
    } catch {
      // 还没起来，继续等
    }
    await sleep(500)
  }
  console.error(`timeout: ${url} 在 ${timeoutSec}s 内未就绪`)
  process.exit(1)
})()
