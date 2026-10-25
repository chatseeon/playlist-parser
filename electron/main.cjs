// 主进程用 CommonJS：
// 1) 酷狗 vendor 脚本在模块加载时就读 navigator.userAgent，而 Electron 31 的
//    主进程（Node 20）没有全局 navigator，必须在加载解析器之前先补上；
// 2) Electron 主进程里从 CJS 入口 import('electron') 会触发 Node 的
//    cjsPreparseModuleExports 崩溃，所以主进程本身别用 ESM。
// 解析器（src/）仍是 ESM，用动态 import 在运行时加载，此时
// navigator 已经补好，链接阶段不会出问题。
if (typeof globalThis.navigator === 'undefined') {
  globalThis.navigator = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
  }
}

const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const sanitizeName = (name) => String(name || '歌单').replace(/[\\/:*?"<>|]/g, '_').trim() || '歌单'

// src/ 是 ESM，懒加载一次并缓存
let parserMod = null
const loadParser = async () => (parserMod ??= await import('../src/parser.js'))
let exportMod = null
const loadExport = async () => (exportMod ??= await import('../src/export.js'))
let playlistMod = null
const loadPlaylist = async () => (playlistMod ??= await import('../src/playlist-file.js'))
let syncMod = null
const loadSync = async () => (syncMod ??= await import('../src/sync.js'))

// 最近一次解析/导入的歌单，导出和备份都用它，不用让渲染进程把大数据再传回来
// current = { title, playlists: [{ name, songs, json }] }
let current = null

const summarize = (playlists) => playlists.map(p => ({
  name: p.name,
  total: p.songs.length,
  songs: p.songs.map(m => ({ name: m?.name, singer: m?.singer })),
}))

// ---- GitHub 备份设置 ----
// 便携版：设置存在 exe 旁边的 sync-config.json，跟着 exe 走；开发模式（npm start）存在 userData。
// 令牌用系统钥匙串（safeStorage，绑定当前 Windows 账号）加密后才落盘，换电脑后需重新填写；
// 系统不支持加密时令牌只放内存（本次运行有效），绝不明文写盘。
const configPath = () => path.join(process.env.PORTABLE_EXECUTABLE_DIR || app.getPath('userData'), 'sync-config.json')
let syncConfig = null
let memoryToken = null

const loadSyncConfig = () => {
  if (syncConfig) return syncConfig
  try {
    syncConfig = JSON.parse(fs.readFileSync(configPath(), 'utf8'))
  } catch (_) {
    syncConfig = {}
  }
  return syncConfig
}

const saveSyncConfig = () => {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(syncConfig, null, 2), 'utf8')
}

const getToken = () => {
  if (memoryToken) return memoryToken
  const enc = loadSyncConfig().tokenEnc
  if (!enc || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch (_) {
    return null
  }
}

const publicConfig = async () => {
  const c = loadSyncConfig()
  const { hasGit } = await loadSync()
  return {
    mode: c.mode || 'auto',
    repo: c.repo || '',
    branch: c.branch || '',
    dir: c.dir ?? 'playlists',
    autoSync: !!c.autoSync,
    hasToken: !!getToken(),
    canEncrypt: safeStorage.isEncryptionAvailable(),
    gitAvailable: await hasGit(),
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 880,
    height: 740,
    minWidth: 640,
    minHeight: 560,
    title: '歌单解析器',
    autoHideMenuBar: true,
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  return win
}

// 解析：输入 source + 链接/码，返回精简结果（完整数据留在主进程）
ipcMain.handle('parse', async (_e, payload) => {
  const { source, input, all } = payload || {}
  try {
    const { parse, parseAll } = await loadParser()
    const { toPlaylists } = await loadPlaylist()
    const result = all ? await parseAll(source, input) : await parse(source, input)
    const playlists = toPlaylists(result)
    current = { title: result.info?.name, playlists }
    return {
      ok: true,
      name: result.info?.name,
      author: result.info?.author,
      source,
      total: result.total ?? result.list?.length ?? 0,
      playlists: summarize(playlists),
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

// 导入：选择 LX Music 导出的歌单/备份文件（.lxmc / .json），可多选
ipcMain.handle('import', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '选择 LX Music 导出的歌单文件',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'LX Music 歌单 / 备份', extensions: ['lxmc', 'json', 'gz'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  if (canceled || !filePaths.length) return { canceled: true }
  try {
    const { readPlaylistFile } = await loadPlaylist()
    const playlists = filePaths.flatMap(f => readPlaylistFile(f))
    if (!playlists.length) throw new Error('文件里没有歌单')
    const title = playlists.length === 1
      ? playlists[0].name
      : filePaths.length === 1 ? path.basename(filePaths[0]) : `${filePaths.length} 个文件`
    current = { title, playlists }
    return {
      ok: true,
      name: title,
      total: playlists.reduce((n, p) => n + p.songs.length, 0),
      playlists: summarize(playlists),
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

// 导出：弹系统「另存为」对话框，写 Markdown 或 JSON（内容取自 current）
ipcMain.handle('export', async (e, payload) => {
  const { type } = payload || {}
  if (!current) return { canceled: false, error: '还没有解析或导入歌单' }
  const isMd = type === 'md'
  if (!isMd && current.playlists.length !== 1) {
    return { canceled: false, error: '多个歌单不能合并导出为一个 JSON' }
  }
  const win = BrowserWindow.fromWebContents(e.sender)
  const base = sanitizeName(current.title)
  const defaultPath = isMd ? `${base}_歌名和作者.md` : `${base}.json`
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '保存歌单',
    defaultPath,
    filters: isMd
      ? [{ name: 'Markdown 文字歌单', extensions: ['md'] }]
      : [{ name: 'JSON 数据', extensions: ['json'] }],
  })
  if (canceled || !filePath) return { canceled: true }
  try {
    if (isMd) {
      const { buildMarkdown } = await loadExport()
      const md = current.playlists.map(p => buildMarkdown(p.name, p.songs)).join('\n')
      fs.writeFileSync(filePath, '﻿' + md, 'utf8')
    } else {
      fs.writeFileSync(filePath, JSON.stringify(current.playlists[0].json, null, 2), 'utf8')
    }
    return { canceled: false, filePath }
  } catch (err) {
    return { canceled: false, error: err?.message || String(err) }
  }
})

// ---- GitHub 备份 ----
ipcMain.handle('sync:getConfig', () => publicConfig())

// token：undefined/空串 = 保持不变；clearToken = 删除已保存的令牌
ipcMain.handle('sync:saveConfig', async (_e, payload) => {
  const { mode, repo, branch, dir, autoSync, token, clearToken } = payload || {}
  try {
    const c = loadSyncConfig()
    const { normalizeRepo } = await loadSync()
    c.mode = ['git', 'token'].includes(mode) ? mode : 'auto'
    c.repo = normalizeRepo(repo)
    c.branch = String(branch || '').trim()
    c.dir = String(dir || '').trim() || 'playlists'
    c.autoSync = !!autoSync
    if (clearToken) {
      delete c.tokenEnc
      memoryToken = null
    } else if (token && token.trim()) {
      if (safeStorage.isEncryptionAvailable()) {
        c.tokenEnc = safeStorage.encryptString(token.trim()).toString('base64')
        memoryToken = null
      } else {
        memoryToken = token.trim()
      }
    }
    saveSyncConfig()
    return { ok: true, config: await publicConfig() }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

const resolveTarget = () => {
  const c = loadSyncConfig()
  return {
    mode: c.mode || 'auto',
    repo: c.repo,
    token: getToken() || undefined,
    branch: c.branch || undefined,
    dir: c.dir ?? 'playlists',
    apiBase: process.env.GITHUB_API_URL || undefined,
  }
}

ipcMain.handle('sync:test', async () => {
  try {
    const { testSync } = await loadSync()
    return { ok: true, ...(await testSync(resolveTarget())) }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

let syncing = false
ipcMain.handle('sync:push', async () => {
  if (!current) return { ok: false, error: '还没有解析或导入歌单' }
  if (syncing) return { ok: false, error: '正在备份中，请稍候' }
  syncing = true
  try {
    const { sync } = await loadSync()
    const res = await sync({ ...resolveTarget(), playlists: current.playlists })
    return { ok: true, ...res }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  } finally {
    syncing = false
  }
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
