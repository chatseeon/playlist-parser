// 精简自上游项目的 kw/util.js，只保留歌单解析用到的两个纯函数。
// 原版其余内容（decodeLyric、wbdCrypto 等）依赖 Electron IPC，已剔除。

export const objStr2JSON = (str) => {
  return JSON.parse(str.replace(/('(?=(,\s*')))|('(?=:))|((?<=([:,]\s*))')|((?<={)')|('(?=}))/g, '"'))
}

export const formatSinger = (rawData) => rawData.replace(/&/g, '、')
