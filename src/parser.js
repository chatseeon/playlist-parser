import kg from './sources/kg/songList.js'
import wy from './sources/wy/songList.js'
import tx from './sources/tx/songList.js'
import mg from './sources/mg/songList.js'
import kw from './sources/kw/songList.js'

export const sources = { kg, wy, tx, mg, kw }

export const sourceNames = {
  kg: '酷狗音乐',
  wy: '网易音乐',
  tx: 'QQ音乐',
  mg: '咪咕音乐',
  kw: '酷我音乐',
}

/**
 * 解析歌单（单页）
 * @param {keyof sources} source 音源 id：kg/wy/tx/mg/kw
 * @param {string|number} id 歌单链接、分享码、酷狗码或纯 id
 * @param {number} page 页码
 * @returns {Promise<{ list, page, limit, total, source, info }>}
 */
export async function parse(source, id, page = 1) {
  const mod = sources[source]
  if (!mod) throw new Error(`未知音源: ${source}（支持 kg/wy/tx/mg/kw）`)
  return mod.getListDetail(String(id), page)
}

/**
 * 解析歌单（自动跨页拉全量）
 */
export async function parseAll(source, id) {
  const first = await parse(source, id, 1)
  const list = [...first.list]
  const total = first.total || list.length
  let page = 2
  // 最多拉 200 页，防止异常接口死循环
  while (list.length < total && page <= 200) {
    const r = await parse(source, id, page)
    list.push(...r.list)
    if (!r.list.length) break
    page += 1
  }
  return { ...first, list, total: list.length }
}
