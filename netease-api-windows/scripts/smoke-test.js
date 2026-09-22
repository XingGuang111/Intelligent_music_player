'use strict'

/**
 * 接口冒烟测试：逐个验证核心接口，输出通过/失败清单。
 * 用法： node scripts/smoke-test.js [baseUrl]
 */

const BASE = process.argv[2] || process.env.API_BASE || 'http://127.0.0.1:3000'

const cases = [
  { name: '健康检查', path: '/health' },
  { name: '搜索单曲', path: '/search?keywords=%E5%91%A8%E6%9D%B0%E4%BC%A6&type=1&limit=3' },
  { name: '搜索歌单', path: '/search?keywords=%E7%83%AD%E6%AD%8C&type=1000&limit=3' },
  { name: '歌曲详情', path: '/song/detail?ids=347230' },
  { name: '歌词', path: '/lyric?id=347230' },
  { name: '歌单详情', path: '/playlist/detail?id=24381616' },
  { name: '登录状态', path: '/login/status' },
]

async function hit(path) {
  const started = Date.now()
  try {
    const res = await fetch(BASE + path, { redirect: 'manual' })
    const cost = Date.now() - started
    let body
    const text = await res.text()
    try {
      body = JSON.parse(text)
    } catch {
      body = { raw: text.slice(0, 120) }
    }
    return { res, body, cost }
  } catch (err) {
    return { error: err.message }
  }
}

function brief(body) {
  if (!body) return ''
  if (body.code === 200 || body.status === 'ok') {
    if (Array.isArray(body.songs)) return `命中 ${body.songs.length} 首，首条：${body.songs[0]?.name ?? '-'}`
    if (Array.isArray(body.result?.songs)) return `命中 ${body.result.songs.length} 首，首条：${body.result.songs[0]?.name ?? '-'}`
    if (Array.isArray(body.result?.playlists)) return `命中 ${body.result.playlists.length} 个，首条：${body.result.playlists[0]?.name ?? '-'}`
    if (body.lrc) return `歌词 ${body.lrc.lyric.length} 字符`
    if (body.playlist) return `歌单：${body.playlist.name}（${body.playlist.trackCount} 首）`
    if (body.data?.profile) return `已登录：${body.data.profile.nickname}`
    if (body.data?.account) return `已登录：${body.data.account.userName ?? '-'}`
    return 'ok'
  }
  return `code=${body.code ?? '?'} msg=${body.msg ?? body.message ?? ''}`
}

;(async () => {
  console.log(`\n目标服务: ${BASE}\n`)
  console.log('状态  接口            耗时     说明')
  console.log('----  --------------  -------  ----------------------------------')

  let pass = 0
  let fail = 0

  for (const c of cases) {
    const r = await hit(c.path)
    if (r.error) {
      fail++
      console.log(`FAIL  ${c.name.padEnd(14)}  -        ${r.error}`)
      continue
    }
    const ok = r.res.status === 200 && (r.body.code === 200 || r.body.status === 'ok' || c.name === '登录状态')
    ok ? pass++ : fail++
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(14)}  ${String(r.cost + 'ms').padEnd(7)}  ${brief(r.body)}`,
    )
  }

  console.log(`\n合计: ${pass} 通过 / ${fail} 失败\n`)
  process.exit(fail > 0 ? 1 : 0)
})()
