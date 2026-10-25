const $ = (sel) => document.querySelector(sel)

const sourceEl = $('#source')
const inputEl = $('#input')
const allEl = $('#all')
const parseBtn = $('#parseBtn')
const importBtn = $('#importBtn')
const resultEl = $('#result')
const nameEl = $('#name')
const metaEl = $('#meta')
const songListEl = $('#songList')
const exportMdBtn = $('#exportMd')
const exportJsonBtn = $('#exportJson')
const syncBtn = $('#syncBtn')
const statusEl = $('#status')

const syncModeEl = $('#syncMode')
const tokenRowEl = $('#tokenRow')
const syncRepoEl = $('#syncRepo')
const syncBranchEl = $('#syncBranch')
const syncDirEl = $('#syncDir')
const syncTokenEl = $('#syncToken')
const syncAutoEl = $('#syncAuto')
const syncStateEl = $('#syncState')
const syncHintEl = $('#syncHint')

let lastResult = null
let syncConfig = null

let statusTimer = null
function showStatus(msg, isErr = false) {
  statusEl.textContent = msg
  statusEl.classList.toggle('err', isErr)
  statusEl.hidden = false
  clearTimeout(statusTimer)
  statusTimer = setTimeout(() => { statusEl.hidden = true }, isErr ? 8000 : 4000)
}

function setBusy(busy) {
  parseBtn.disabled = busy
  importBtn.disabled = busy
  parseBtn.textContent = busy ? '解析中…' : '解析'
}

async function doParse() {
  const source = sourceEl.value
  const input = inputEl.value.trim()
  if (!input) {
    showStatus('请输入歌单链接或酷狗码', true)
    return
  }
  setBusy(true)
  resultEl.hidden = true
  try {
    const res = await window.api.parse({ source, input, all: allEl.checked })
    if (!res.ok) {
      showStatus('解析失败：' + (res.error || '未知错误'), true)
      return
    }
    await onLoaded(res, '解析成功')
  } catch (err) {
    showStatus('解析失败：' + (err?.message || err), true)
  } finally {
    setBusy(false)
  }
}

// 导入 LX Music 导出的 .lxmc / .json（单个列表或完整备份都行）
async function doImport() {
  setBusy(true)
  try {
    const res = await window.api.import()
    if (res.canceled) return
    if (!res.ok) {
      showStatus('导入失败：' + (res.error || '未知错误'), true)
      return
    }
    await onLoaded(res, '导入成功')
  } catch (err) {
    showStatus('导入失败：' + (err?.message || err), true)
  } finally {
    setBusy(false)
  }
}

// 实际会用的模式：auto 时有 git 用 git，否则用令牌
const effectiveMode = (c) => (c.mode === 'auto' ? (c.gitAvailable ? 'git' : 'token') : c.mode)
const syncReady = (c) => !!(c?.repo && (effectiveMode(c) === 'git' ? c.gitAvailable : c.hasToken))

async function onLoaded(res, okMsg) {
  lastResult = res
  renderResult(res)
  if (syncConfig?.autoSync && syncReady(syncConfig)) {
    showStatus(okMsg + '，正在备份到 GitHub…')
    await doSync()
  } else {
    showStatus(okMsg)
  }
}

function songRow(m, i) {
  const div = document.createElement('div')
  div.className = 'song'
  div.innerHTML =
    '<span class="idx">' + (i + 1) + '</span>' +
    '<span class="title"></span>' +
    '<span class="singer"></span>'
  div.querySelector('.title').textContent = m.name || '未知歌名'
  div.querySelector('.singer').textContent = m.singer || '未知作者'
  return div
}

function renderResult(res) {
  const lists = res.playlists
  const loaded = lists.reduce((n, p) => n + p.total, 0)
  nameEl.textContent = res.name || '(未知歌单)'
  const parts = []
  if (res.author) parts.push('作者：' + res.author)
  if (lists.length > 1) parts.push(lists.length + ' 个歌单')
  parts.push('共 ' + (res.total ?? loaded) + ' 首歌曲')
  if (res.total && res.total > loaded) parts.push('已加载 ' + loaded + ' 首，勾选「拉取全部歌曲」可获取完整歌单')
  metaEl.textContent = parts.join('　')

  // 多个歌单合并不成一个 JSON
  exportJsonBtn.disabled = lists.length !== 1

  const frag = document.createDocumentFragment()
  for (const pl of lists) {
    if (lists.length > 1) {
      const head = document.createElement('div')
      head.className = 'group'
      head.textContent = pl.name
      const count = document.createElement('span')
      count.className = 'count'
      count.textContent = pl.total + ' 首'
      head.appendChild(count)
      frag.appendChild(head)
    }
    pl.songs.forEach((m, i) => frag.appendChild(songRow(m, i)))
  }
  songListEl.replaceChildren(frag)
  songListEl.scrollTop = 0

  resultEl.hidden = false
}

async function doExport(type) {
  if (!lastResult) return
  const res = await window.api.export({ type })
  if (res.canceled) {
    showStatus('已取消保存')
    return
  }
  if (res.error) {
    showStatus('保存失败：' + res.error, true)
    return
  }
  showStatus('已保存到：' + res.filePath)
}

// ---- GitHub 备份 ----
async function doSync() {
  if (!lastResult) return
  if (!syncReady(syncConfig)) {
    $('#syncPanel').open = true
    showStatus('请先填写并保存 GitHub 备份设置', true)
    return
  }
  syncBtn.disabled = true
  syncBtn.textContent = '备份中…'
  try {
    const res = await window.api.push()
    if (!res.ok) {
      showStatus('备份失败：' + (res.error || '未知错误'), true)
      return
    }
    const where = syncConfig.repo + '@' + res.branch + '，' + (res.mode === 'git' ? 'git' : '令牌') + '模式'
    showStatus(res.changed.length
      ? '已备份 ' + res.changed.length + ' 个文件（' + where + '）'
      : '仓库里已是最新（' + where + '）')
  } catch (err) {
    showStatus('备份失败：' + (err?.message || err), true)
  } finally {
    syncBtn.disabled = false
    syncBtn.textContent = '备份到 GitHub'
  }
}

// 按当前选择的模式显示/隐藏令牌框和提示（选择框一变就刷新，不用先保存）
function renderModeHint() {
  if (!syncConfig) return
  const mode = effectiveMode({ ...syncConfig, mode: syncModeEl.value })
  tokenRowEl.hidden = mode === 'git'
  const hints = []
  if (mode === 'git') {
    hints.push(syncConfig.gitAvailable
      ? '使用本机 git 备份，沿用你电脑上已有的 git 登录，不需要令牌。'
      : '本机没有检测到 git，请先安装 git，或改用令牌模式。')
  } else {
    if (syncModeEl.value === 'auto') hints.push('本机没有检测到 git，将使用令牌模式。')
    hints.push(syncConfig.canEncrypt
      ? '令牌经系统加密后保存在本机，不会明文写入磁盘。'
      : '当前系统不支持加密存储，令牌只在本次运行期间有效，关闭程序后需重新填写。')
  }
  syncHintEl.textContent = hints.join('')
}

function renderSyncConfig(c) {
  syncConfig = c
  syncModeEl.value = c.mode
  syncRepoEl.value = c.repo
  syncBranchEl.value = c.branch
  syncDirEl.value = c.dir
  syncAutoEl.checked = c.autoSync
  syncTokenEl.value = ''
  syncTokenEl.placeholder = c.hasToken ? '已保存（留空则不修改）' : 'github_pat_...'
  syncStateEl.textContent = syncReady(c)
    ? '已配置：' + c.repo + '（' + (effectiveMode(c) === 'git' ? 'git' : '令牌') + '模式）'
    : '未配置'
  renderModeHint()
}

async function saveSync(extra = {}) {
  const res = await window.api.saveSyncConfig({
    mode: syncModeEl.value,
    repo: syncRepoEl.value.trim(),
    branch: syncBranchEl.value.trim(),
    dir: syncDirEl.value.trim(),
    autoSync: syncAutoEl.checked,
    token: syncTokenEl.value,
    ...extra,
  })
  if (!res.ok) {
    showStatus('保存失败：' + (res.error || '未知错误'), true)
    return false
  }
  renderSyncConfig(res.config)
  return true
}

async function testSync() {
  if (!(await saveSync())) return
  const res = await window.api.testSync()
  if (!res.ok) {
    showStatus('连接失败：' + (res.error || '未知错误'), true)
    return
  }
  if (res.mode === 'git') {
    showStatus('git 能访问 ' + res.fullName + '（写权限在第一次备份时确认）')
    return
  }
  if (res.canPush === false) {
    showStatus('能访问 ' + res.fullName + '，但没有写权限', true)
    return
  }
  showStatus('连接成功：' + res.fullName + (res.private ? '（私有仓库）' : '（公开仓库，所有人可见）'))
}

parseBtn.addEventListener('click', doParse)
importBtn.addEventListener('click', doImport)
inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doParse() })
exportMdBtn.addEventListener('click', () => doExport('md'))
exportJsonBtn.addEventListener('click', () => doExport('json'))
syncBtn.addEventListener('click', doSync)
syncModeEl.addEventListener('change', renderModeHint)
$('#syncSave').addEventListener('click', async () => { if (await saveSync()) showStatus('备份设置已保存') })
$('#syncTest').addEventListener('click', testSync)
$('#syncClearToken').addEventListener('click', async () => { if (await saveSync({ token: '', clearToken: true })) showStatus('令牌已清除') })

window.api.getSyncConfig().then(renderSyncConfig)
