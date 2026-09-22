'use strict'

/**
 * .env 里 NCM_COOKIE 的读写。
 *
 * 抽出来是为了让「服务进程」和「qr-login 脚本」共用同一套逻辑，
 * 避免两处各写一遍正则（之前就是因为重复实现才埋了 bug）。
 *
 * 对外只暴露纯函数，require 时没有任何副作用（不监听文件、不读环境变量）。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const ENV_PATH = path.join(ROOT, '.env')
const EXAMPLE_PATH = path.join(ROOT, '.env.example')

// 匹配 NCM_COOKIE=xxx 这一行。
// 关键：两侧的空白只能用 [ \t]，绝不能用 \s ——
// \s 包含换行符，当值为空时会把下一行的内容一并吞进来。
const LINE_RE = /^[ \t]*NCM_COOKIE[ \t]*=[ \t]*(.*)$/m

/** .env 不存在时用模板生成一份，避免读写落空 */
function ensureEnv() {
  if (fs.existsSync(ENV_PATH)) return
  try {
    fs.copyFileSync(EXAMPLE_PATH, ENV_PATH)
  } catch {
    fs.writeFileSync(ENV_PATH, 'PORT=3000\nHOST=0.0.0.0\nNCM_COOKIE=\nLOG_LEVEL=info\n', 'utf8')
  }
}

/** 读取当前 Cookie，读不到返回空串 */
function readCookie() {
  try {
    const text = fs.readFileSync(ENV_PATH, 'utf8')
    const m = text.match(LINE_RE)
    if (!m) return ''
    return m[1].trim().replace(/^["']|["']$/g, '')
  } catch {
    return ''
  }
}

/**
 * 把 Cookie 写进 .env（替换已有行，没有就追加），其余配置原样保留。
 * 传空串等同于清空登录态。
 */
function saveCookie(cookie) {
  ensureEnv()
  const text = fs.readFileSync(ENV_PATH, 'utf8')
  const line = `NCM_COOKIE=${cookie || ''}`
  const next = LINE_RE.test(text)
    ? text.replace(LINE_RE, line)
    : text.replace(/\s*$/, '') + '\n' + line + '\n'
  fs.writeFileSync(ENV_PATH, next, 'utf8')
  return Boolean(cookie)
}

/** 清空登录态 */
function clearCookie() {
  return saveCookie('')
}

module.exports = { ENV_PATH, ensureEnv, readCookie, saveCookie, clearCookie }
