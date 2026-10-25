// 歌单 JSON → 文字（Markdown）歌单，输出格式：
//
//   # 歌单名
//
//   共 N 首歌曲
//
//   1. 歌名 - 歌手
//   2. ...

const UNKNOWN_TITLE = '未知歌名'
const UNKNOWN_SINGER = '未知作者'

/**
 * 从歌单名 + 歌曲列表生成 Markdown 文本
 * @param {string} name 歌单名
 * @param {Array} songs 歌曲列表（每项含 name / singer 字段）
 * @returns {string}
 */
export function buildMarkdown(name, songs) {
  const lines = [`# ${name}`, '', `共 ${songs.length} 首歌曲`, '']
  songs.forEach((song, i) => {
    const title = String(song?.name ?? UNKNOWN_TITLE).trim()
    const singer = String(song?.singer ?? UNKNOWN_SINGER).trim()
    lines.push(`${i + 1}. ${title} - ${singer}`)
  })
  return lines.join('\n') + '\n'
}

/**
 * 从 JSON 对象里提取歌单名和歌曲列表。
 * 兼容两种结构：
 *  - 歌单备份格式：{ data: { name, list } }
 *  - 本工具 parse() 的输出格式：{ list, info: { name } }
 */
export function extractPlaylistFromJson(obj) {
  const data = obj?.data ?? {}
  const name = obj?.info?.name ?? data?.name ?? obj?.name ?? '歌单'
  const list = Array.isArray(data?.list) ? data.list : Array.isArray(obj?.list) ? obj.list : []
  return { name, songs: list }
}

/**
 * 直接把 JSON 对象转成 Markdown 文本
 */
export function buildMarkdownFromJson(obj) {
  const { name, songs } = extractPlaylistFromJson(obj)
  return buildMarkdown(name, songs)
}
