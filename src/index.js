// 对应 songList.js 里的 `../../index` 导入源。
// 这里只提供歌单解析实际用到的纯函数。

// 解码 HTML 实体（原版用的是 window.DOMParser，Node 环境改用纯字符串替换，效果一致）
const encodeNames = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#039;': "'",
}
export const decodeName = (str = '') => {
  if (!str) return ''
  return String(str).replace(/(?:&amp;|&lt;|&gt;|&quot;|&apos;|&#039;|&nbsp;)/gm, s => encodeNames[s]) ?? ''
}

export const sizeFormate = (size) => {
  if (!size) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const number = Math.floor(Math.log(size) / Math.log(1024))
  return `${(size / Math.pow(1024, Math.floor(number))).toFixed(2)} ${units[number]}`
}

const numFix = (n) => (n < 10 ? `0${n}` : n.toString())

const toDateObj = (date) => {
  if (!date) return ''
  switch (typeof date) {
    case 'string':
      if (!date.includes('T')) date = date.split('.')[0].replace(/-/g, '/')
    // eslint-disable-next-line no-fallthrough
    case 'number':
      date = new Date(date)
    // eslint-disable-next-line no-fallthrough
    case 'object':
      break
    default:
      return ''
  }
  return date
}

export const dateFormat = (_date, format = 'Y-M-D h:m:s') => {
  const date = toDateObj(_date)
  if (!date) return ''
  return format
    .replace('Y', date.getFullYear().toString())
    .replace('M', numFix(date.getMonth() + 1))
    .replace('D', numFix(date.getDate()))
    .replace('h', numFix(date.getHours()))
    .replace('m', numFix(date.getMinutes()))
    .replace('s', numFix(date.getSeconds()))
}

export const formatPlayTime = (time) => {
  const m = Math.trunc(time / 60)
  const s = Math.trunc(time % 60)
  return m == 0 && s == 0 ? '--/--' : numFix(m) + ':' + numFix(s)
}

export const formatPlayCount = (num) => {
  if (num > 100000000) return `${Math.trunc(num / 10000000) / 10}亿`
  if (num > 10000) return `${Math.trunc(num / 1000) / 10}万`
  return String(num)
}
