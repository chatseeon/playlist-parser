// 把歌单备份到 GitHub 仓库。只用 Node 内置的 fetch / crypto，不引入新依赖。
//
// 用 Git Data API（blob → tree → commit → 更新分支）一次提交多个文件：
//   - 一次备份只产生一个 commit，不会把仓库历史刷屏；
//   - 先在本地算 blob sha 和远端比对，没变的文件不上传，全没变就不提交；
//   - 所有写请求串行发出（GitHub 不建议并发写同一仓库）。
// 备份只新增/更新文件，从不删除仓库里的文件。

import crypto from 'node:crypto'
import { buildSyncFiles } from './playlist-file.js'

const DEFAULT_API = 'https://api.github.com'
// 单个文件小于这个大小时直接内联在 tree 请求里，省掉一次 blob 请求
const INLINE_LIMIT = 512 * 1024
const INLINE_TOTAL_LIMIT = 4 * 1024 * 1024

export class GitHubError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'GitHubError'
    this.status = status
  }
}

/**
 * 计算 git blob sha（和 `git hash-object` 一致），用来判断文件是否有变化
 */
export const gitBlobSha = (content) => {
  const buf = Buffer.from(content, 'utf8')
  return crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')
}

/**
 * 解析仓库地址：owner/repo、https://github.com/owner/repo(.git)、git@github.com:owner/repo.git
 */
export function parseRepo(spec) {
  const s = String(spec || '').trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com[/:]/i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
  const m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(s)
  if (!m || m[2] === '.' || m[2] === '..') throw new Error(`仓库格式不对：「${spec}」，应为 用户名/仓库名`)
  return { owner: m[1], repo: m[2] }
}

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/')

const describeError = (status, apiMsg, res) => {
  switch (status) {
    case 401: return '令牌无效或已过期（401），请重新生成 GitHub 令牌'
    case 403:
      if (res.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(apiMsg)) {
        return '触发了 GitHub 频率限制（403），请稍后再试'
      }
      return `没有权限（403）：请确认令牌对该仓库有 Contents 读写权限。${apiMsg}`
    case 429: return '请求太频繁（429），请稍后再试'
    default: return `GitHub 返回 ${status}：${apiMsg}`
  }
}

/**
 * 极简 GitHub REST 客户端
 */
export function createClient({ token, apiBase = DEFAULT_API, fetchImpl = globalThis.fetch, timeout = 30000 }) {
  if (!token) throw new Error('缺少 GitHub 令牌')
  const base = apiBase.replace(/\/+$/, '')
  return async(method, url, body) => {
    let res
    try {
      res = await fetchImpl(base + url, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'playlist-parser-sync',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
      })
    } catch (err) {
      throw new GitHubError(`连接 GitHub 失败：${err?.cause?.code || err?.message || err}`, 0)
    }
    const text = await res.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch (_) { data = text }
    if (!res.ok) {
      const apiMsg = (data && data.message) || res.statusText || ''
      throw new GitHubError(describeError(res.status, apiMsg, res), res.status)
    }
    return data
  }
}

// 取分支最新 commit；仓库为空返回 { empty: true }
const getHead = async(gh, owner, repo, branch) => {
  try {
    const ref = await gh('GET', `/repos/${owner}/${repo}/git/ref/heads/${encodePath(branch)}`)
    return { sha: ref.object.sha }
  } catch (err) {
    if (err.status === 409) return { empty: true }
    if (err.status === 404) throw new GitHubError(`分支 ${branch} 不存在，请先在仓库里创建，或改用默认分支`, 404)
    throw err
  }
}

// 空仓库没有分支，Git Data API 用不了，先用 Contents API 写入第一个文件，顺带创建分支
const bootstrap = async(gh, owner, repo, branch, defaultBranch, file) => {
  const res = await gh('PUT', `/repos/${owner}/${repo}/contents/${encodePath(file.path)}`, {
    message: `初始化：添加 ${file.path}`,
    content: Buffer.from(file.content, 'utf8').toString('base64'),
    ...(branch !== defaultBranch ? { branch } : {}),
  })
  return res.commit.sha
}

// 在 headSha 之上提交 files；返回 null 表示无变化，'conflict' 表示分支被别人抢先更新了
const commitFiles = async(gh, owner, repo, branch, headSha, files, message) => {
  const commit = await gh('GET', `/repos/${owner}/${repo}/git/commits/${headSha}`)
  const tree = await gh('GET', `/repos/${owner}/${repo}/git/trees/${commit.tree.sha}?recursive=1`)

  const remote = new Map()
  const rootNames = new Set()
  for (const item of tree.tree || []) {
    if (item.type === 'blob') remote.set(item.path, item.sha)
    if (!item.path.includes('/')) rootNames.add(item.path.toLowerCase())
  }

  const entries = []
  const changed = []
  let inlineTotal = 0
  for (const file of files) {
    if (file.ifMissing) {
      // 已存在（或树被截断无法确认）时不碰，例如用户自己改过的 README
      if (tree.truncated || rootNames.has(file.path.toLowerCase()) || remote.has(file.path)) continue
    }
    const sha = gitBlobSha(file.content)
    if (remote.get(file.path) === sha) continue

    const size = Buffer.byteLength(file.content, 'utf8')
    if (size <= INLINE_LIMIT && inlineTotal + size <= INLINE_TOTAL_LIMIT) {
      inlineTotal += size
      entries.push({ path: file.path, mode: '100644', type: 'blob', content: file.content })
    } else {
      const blob = await gh('POST', `/repos/${owner}/${repo}/git/blobs`, {
        content: Buffer.from(file.content, 'utf8').toString('base64'),
        encoding: 'base64',
      })
      entries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha })
    }
    changed.push(file.path)
  }
  if (!entries.length) return null

  const newTree = await gh('POST', `/repos/${owner}/${repo}/git/trees`, { base_tree: commit.tree.sha, tree: entries })
  if (newTree.sha === commit.tree.sha) return null

  const newCommit = await gh('POST', `/repos/${owner}/${repo}/git/commits`, {
    message,
    tree: newTree.sha,
    parents: [headSha],
  })
  try {
    // force: false —— 只允许快进，绝不覆盖别人的提交
    await gh('PATCH', `/repos/${owner}/${repo}/git/refs/heads/${encodePath(branch)}`, { sha: newCommit.sha, force: false })
  } catch (err) {
    // GitHub 对非快进更新返回 422 "Update is not a fast forward"
    if (err.status === 422 && /fast.?forward/i.test(err.message)) return 'conflict'
    throw err
  }
  return { sha: newCommit.sha, changed }
}

/**
 * 把一组文件提交到仓库（一次 commit）
 * @param {object} opts
 * @param {string} opts.token GitHub 令牌（fine-grained token，只需要目标仓库的 Contents 读写权限）
 * @param {string} opts.owner
 * @param {string} opts.repo
 * @param {string} [opts.branch] 缺省为仓库默认分支
 * @param {{ path: string, content: string, ifMissing?: boolean }[]} opts.files ifMissing=true 表示仅在不存在时创建
 * @param {string} opts.message commit 信息
 * @returns {Promise<{ changed: string[], commitSha?: string, commitUrl?: string, repoUrl: string, branch: string, private: boolean }>}
 */
export async function pushFiles({ token, owner, repo, branch, files, message, apiBase, fetchImpl }) {
  if (!files?.length) throw new Error('没有要备份的文件')
  const gh = createClient({ token, apiBase, fetchImpl })

  let info
  try {
    info = await gh('GET', `/repos/${owner}/${repo}`)
  } catch (err) {
    if (err.status === 404) throw new GitHubError(`找不到仓库 ${owner}/${repo}：仓库不存在，或令牌没有访问它的权限`, 404)
    throw err
  }
  if (info.permissions && info.permissions.push === false) {
    throw new GitHubError(`对仓库 ${owner}/${repo} 没有写权限`, 403)
  }
  branch = branch || info.default_branch
  const result = { changed: [], repoUrl: info.html_url, branch, private: !!info.private }

  let head = await getHead(gh, owner, repo, branch)
  if (head.empty) {
    const first = files.find(f => f.ifMissing) || files[0]
    head = { sha: await bootstrap(gh, owner, repo, branch, info.default_branch, first) }
    result.changed.push(first.path)
    files = files.filter(f => f !== first)
    result.commitSha = head.sha
  }

  // 分支在两次请求之间被别处更新时，拉最新的再试一次
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await commitFiles(gh, owner, repo, branch, head.sha, files, message)
    if (r === 'conflict') {
      head = await getHead(gh, owner, repo, branch)
      continue
    }
    if (r) {
      result.changed.push(...r.changed)
      result.commitSha = r.sha
    }
    if (result.commitSha) result.commitUrl = `${info.html_url}/commit/${result.commitSha}`
    return result
  }
  throw new GitHubError('分支一直在被其他地方更新，请稍后重试', 422)
}

/**
 * 检查令牌和仓库是否可用（只读，不改动仓库）
 */
export async function checkRepo({ token, owner, repo, apiBase, fetchImpl }) {
  const gh = createClient({ token, apiBase, fetchImpl })
  try {
    const info = await gh('GET', `/repos/${owner}/${repo}`)
    return {
      fullName: info.full_name,
      private: !!info.private,
      defaultBranch: info.default_branch,
      canPush: info.permissions ? !!info.permissions.push : null,
      repoUrl: info.html_url,
    }
  } catch (err) {
    if (err.status === 404) throw new GitHubError(`找不到仓库 ${owner}/${repo}：仓库不存在，或令牌没有访问它的权限`, 404)
    throw err
  }
}

const README = `# 我的歌单

这个仓库用来备份我在 [LX Music（洛雪音乐）](https://github.com/lyswhut/lx-music-desktop) 里的歌单，
由「歌单解析器」自动备份。

## 文件说明

每个歌单两份文件，放在 \`{dir}\` 目录下：

- \`歌单名.json\`：原始歌单数据。来自 LX Music 导出文件的，可以在 LX Music 里通过「导入列表」还原
- \`歌单名.md\`：文字歌单（歌名 - 歌手），方便直接浏览

## 来源与致谢

- 歌单数据来自 LX Music 的列表导出，或各音乐平台的公开歌单
- 备份工具的歌单解析部分改编自 [lyswhut/lx-music-desktop](https://github.com/lyswhut/lx-music-desktop)，
  遵循 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- 本仓库与 LX Music 官方无关，仅供个人备份，只存歌名、歌手等元数据，不含任何音频文件；歌曲版权归各音乐平台及版权方所有
`

/**
 * 要写入仓库的全部文件：每个歌单一份 .json + .md，外加仅在缺失时创建的说明来源的 README
 * （git 模式和令牌模式共用）
 */
export function buildRepoFiles(playlists, dir = 'playlists') {
  if (!playlists?.length) throw new Error('没有要备份的歌单')
  const files = buildSyncFiles(playlists, dir)
  const dirLabel = String(dir).replace(/\\/g, '/').split('/').filter(Boolean).join('/') || '/'
  files.unshift({ path: 'README.md', content: README.replace('{dir}', () => dirLabel), ifMissing: true })
  return files
}

export function defaultMessage(playlists) {
  const names = playlists.map(p => p.name)
  return names.length <= 3
    ? `备份歌单：${names.join('、')}`
    : `备份歌单：${names.slice(0, 3).join('、')} 等 ${names.length} 个`
}

/**
 * 令牌模式备份：通过 GitHub API 提交
 * @param {object} opts
 * @param {{ name: string, songs: any[], json: any }[]} opts.playlists
 * @param {string} [opts.dir] 仓库内目录，默认 playlists
 */
export async function syncPlaylists({ playlists, dir = 'playlists', message, ...rest }) {
  const files = buildRepoFiles(playlists, dir)
  return pushFiles({ ...rest, files, message: message || defaultMessage(playlists) })
}
