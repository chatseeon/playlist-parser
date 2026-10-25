// 读取洛雪音乐（LX Music）导出的歌单文件，并整理成「待备份文件」。
//
// LX 的导出文件（见上游 src/common/utils/nodejs.ts 的 saveLxConfigFile）：
//   - .lxmc = gzip(JSON.stringify(data))
//   - .json = 明文 JSON
// 顶层 type 有以下几种（见上游 SettingBackup.vue / useShare.ts）：
//   - playListPart_v2 / playListPart：单个列表 { type, data: { id, name, list, ... } }
//   - playList_v2 / playList：全部列表 { type, data: [列表, ...] }
//   - allData_v2 / allData：完整备份 { type, setting, playList: [列表, ...] }
//   - defautlList（上游拼写如此）：0.6.2 及以前的默认列表
// 另外也接受本工具 parse() 的输出 { list, info }。

import fs from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { buildMarkdown, extractPlaylistFromJson } from './export.js'

// LX 内置列表的 id（上游 src/common/constants.ts 的 LIST_IDS）
const BUILTIN_LIST_NAMES = {
  default: '试听列表',
  love: '我的收藏',
}

const listName = (list) => list?.name || BUILTIN_LIST_NAMES[list?.id] || list?.id || '歌单'

/**
 * 解码 LX 配置文件内容：自动识别 gzip（不依赖扩展名），兼容 BOM 与上游 v1.14.0 的二次序列化问题
 * @param {Buffer} buf
 */
export function decodeLxConfig(buf) {
  const isGzip = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b
  let text = (isGzip ? gunzipSync(buf) : buf).toString('utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  let data = JSON.parse(text)
  if (typeof data === 'string') data = JSON.parse(data)
  return data
}

/**
 * 把 JSON 对象拆成歌单数组。每项：
 *   name  歌单名
 *   songs 歌曲列表（用于生成文字歌单）
 *   json  要上传的 JSON 内容。LX 列表统一包成 playListPart(_v2)，可以在 LX 里「导入列表」还原
 * @returns {{ name: string, songs: any[], json: any }[]}
 */
export function toPlaylists(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('不是有效的歌单 JSON')

  const fromLists = (lists, partType) => {
    if (!Array.isArray(lists)) throw new Error(`${obj.type} 文件结构异常：缺少列表数组`)
    return lists.map(list => ({
      name: listName(list),
      songs: Array.isArray(list?.list) ? list.list : [],
      json: { type: partType, data: list },
    }))
  }

  switch (obj.type) {
    case 'playListPart_v2':
    case 'playListPart':
      return [{ name: listName(obj.data), songs: obj.data?.list ?? [], json: obj }]
    case 'playList_v2':
      return fromLists(obj.data, 'playListPart_v2')
    case 'playList':
      return fromLists(obj.data, 'playListPart')
    // 完整备份只取列表，丢弃 setting：设置里可能有同步服务地址、自定义源等，不应上传
    case 'allData_v2':
      return fromLists(obj.playList, 'playListPart_v2')
    case 'allData':
      if (obj.defaultList) return fromLists([{ id: 'default', ...obj.defaultList }], 'playListPart')
      return fromLists(obj.playList, 'playListPart')
    case 'defautlList':
      return fromLists([{ id: 'default', ...obj.data }], 'playListPart')
    case undefined: {
      // 本工具 parse() 的输出，或其他只有 list 的 JSON
      const { name, songs } = extractPlaylistFromJson(obj)
      if (!Array.isArray(obj.list) && !Array.isArray(obj.data?.list)) throw new Error('JSON 里没有找到歌曲列表')
      return [{ name, songs, json: obj }]
    }
    default:
      throw new Error(`不支持的文件类型：${obj.type}（只支持歌单 / 完整备份文件）`)
  }
}

/**
 * 读取歌单文件（.lxmc / .json / .gz）
 */
export function readPlaylistFile(filePath) {
  return toPlaylists(decodeLxConfig(fs.readFileSync(filePath)))
}

const sanitizeFileName = (name) => {
  const s = String(name)
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 80)
  if (!s || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) return `_${s || '歌单'}`
  return s
}

/**
 * 把歌单数组转成要写入仓库的文件：每个歌单一份 .json（原始数据）+ 一份 .md（文字歌单）
 * @param {{ name: string, songs: any[], json: any }[]} playlists
 * @param {string} dir 仓库内的目录，如 'playlists'
 * @returns {{ path: string, content: string }[]}
 */
export function buildSyncFiles(playlists, dir = 'playlists') {
  const base = String(dir).replace(/\\/g, '/').split('/').filter(Boolean)
  if (base.some(seg => seg === '..' || seg === '.')) throw new Error(`备份目录不合法：${dir}`)
  const prefix = base.length ? base.join('/') + '/' : ''

  const used = new Set()
  const files = []
  for (const pl of playlists) {
    const stem = sanitizeFileName(pl.name)
    // 同名歌单加序号，Windows/macOS 文件系统不区分大小写，按小写去重
    let name = stem
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${stem} (${i})`
    used.add(name.toLowerCase())

    files.push({ path: `${prefix}${name}.json`, content: JSON.stringify(pl.json, null, 2) + '\n' })
    files.push({ path: `${prefix}${name}.md`, content: buildMarkdown(pl.name, pl.songs) })
  }
  return files
}
