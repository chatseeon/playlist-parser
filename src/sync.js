// 备份入口：在 git 模式和令牌模式之间选择
//   mode = 'auto'（默认）：本机装了 git 就用 git，否则用令牌
//   mode = 'git'：只用 git（沿用电脑已有的 git 登录，不需要令牌）
//   mode = 'token'：只用 GitHub 令牌（电脑上不需要装 git）

import { parseRepo, checkRepo, syncPlaylists } from './github-sync.js'
import { hasGit, isRepoUrl, checkGitRemote, syncPlaylistsGit } from './git-sync.js'

export { hasGit }

/**
 * 统一仓库写法：完整地址原样保留（git 模式支持非 GitHub 的地址），其余规范成 用户名/仓库
 */
export function normalizeRepo(spec) {
  const s = String(spec || '').trim()
  if (!s) return ''
  if (isRepoUrl(s)) return s
  const { owner, repo } = parseRepo(s)
  return `${owner}/${repo}`
}

export async function resolveMode(mode = 'auto') {
  if (mode === 'git' || mode === 'token') return mode
  return (await hasGit()) ? 'git' : 'token'
}

/**
 * @param {object} opts
 * @param {'auto'|'git'|'token'} [opts.mode]
 * @param {string} opts.repo
 * @param {string} [opts.token] 令牌模式需要
 * @param {string} [opts.branch]
 * @param {string} [opts.dir]
 * @param {{ name: string, songs: any[], json: any }[]} opts.playlists
 */
export async function sync({ mode, repo, token, branch, dir, playlists, apiBase }) {
  if (!repo) throw new Error('还没有填写目标仓库')
  const m = await resolveMode(mode)
  if (m === 'git') {
    if (!(await hasGit())) throw new Error('没有找到 git，请先安装 git，或改用令牌模式')
    return { mode: m, ...(await syncPlaylistsGit({ repo, branch, dir, playlists })) }
  }
  if (!token) throw new Error('令牌模式需要 GitHub 令牌（本机没有 git 时只能用令牌模式）')
  const { owner, repo: name } = parseRepo(repo)
  return { mode: m, ...(await syncPlaylists({ token, owner, repo: name, branch, dir, playlists, apiBase })) }
}

/**
 * 测试连接（只读，不改动仓库）
 */
export async function testSync({ mode, repo, token, apiBase }) {
  if (!repo) throw new Error('还没有填写目标仓库')
  const m = await resolveMode(mode)
  if (m === 'git') {
    const { remote } = await checkGitRemote(repo)
    return { mode: m, fullName: remote, private: null, canPush: null }
  }
  if (!token) throw new Error('令牌模式需要 GitHub 令牌')
  const { owner, repo: name } = parseRepo(repo)
  return { mode: m, ...(await checkRepo({ token, owner, repo: name, apiBase })) }
}
