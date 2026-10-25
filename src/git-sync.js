// git 模式：调用本机已安装的 git 备份，沿用电脑上已有的 git 登录
// （Git Credential Manager 保存的凭据 / SSH 密钥），不需要令牌。
// 每次备份：浅克隆到临时目录 → 写入文件 → commit → push → 删除临时目录。
// 备份只新增/更新文件，从不删除仓库里的文件。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { parseRepo, buildRepoFiles, defaultMessage } from './github-sync.js'

const GIT_TIMEOUT = 120000

const run = (args, cwd) => new Promise((resolve, reject) => {
  execFile('git', args, {
    cwd,
    timeout: GIT_TIMEOUT,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    // 禁止交互式询问账号密码：GUI 里没有终端，问了只会卡住。
    // 所以要求这台电脑之前已经用 git 登录过（在终端或 VS Code 里 push 过一次即可）
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }, (err, stdout, stderr) => {
    if (err) {
      err.stderr = String(stderr || '')
      return reject(err)
    }
    resolve(String(stdout).trim())
  })
})

let gitAvailable = null
export async function hasGit() {
  if (gitAvailable === null) gitAvailable = await run(['--version']).then(() => true, () => false)
  return gitAvailable
}

// 只放行 https / ssh 地址，其余按 GitHub 的 用户名/仓库 处理（也挡住 ext:: 之类能执行命令的协议）
export const isRepoUrl = (s) => /^(https?:\/\/|ssh:\/\/|git@)/i.test(String(s || '').trim())

export function toRemoteUrl(spec) {
  const s = String(spec || '').trim()
  if (isRepoUrl(s)) return s
  const { owner, repo } = parseRepo(s)
  return `https://github.com/${owner}/${repo}.git`
}

const explain = (err, remote, branch) => {
  const msg = err.stderr || ''
  if (err.code === 'ENOENT') return '没有找到 git，请先安装 git，或改用令牌模式'
  if (err.killed) return 'git 操作超时，请检查网络后重试'
  if (/Remote branch .* not found/i.test(msg)) return `分支 ${branch} 不存在，请先在仓库里创建，或留空使用默认分支`
  if (/Authentication failed|could not read Username|terminal prompts disabled|Permission denied \(publickey\)/i.test(msg)) {
    return `git 登录失败：这台电脑还没有 ${remote} 的登录凭据。请先在终端或 VS Code 里对这个仓库 push 一次完成登录，或改用令牌模式`
  }
  if (/Please tell me who you are|unable to auto-detect email/i.test(msg)) {
    return '还没有配置 git 用户名和邮箱，请先运行 git config --global user.name "你的名字" 和 git config --global user.email "你的邮箱"'
  }
  if (/Repository not found|does not appear to be a git repository/i.test(msg)) return `找不到仓库 ${remote}：仓库不存在，或当前 git 账号没有访问权限`
  if (/Permission to .* denied|error: 403/i.test(msg)) return `当前 git 账号对 ${remote} 没有写权限`
  if (/\[rejected\]|non-fast-forward|fetch first/i.test(msg)) return '远端分支在备份过程中被更新了，请重试'
  return `git 出错：${msg.trim().split('\n').slice(-3).join(' ') || err.message}`
}

/**
 * 检查 git 能否访问仓库（只读）
 */
export async function checkGitRemote(repo) {
  const remote = toRemoteUrl(repo)
  try {
    await run(['ls-remote', '--heads', remote])
  } catch (err) {
    throw new Error(explain(err, remote))
  }
  return { remote }
}

/**
 * git 模式备份
 * @param {object} opts
 * @param {string} opts.repo 用户名/仓库，或完整的 https / ssh 地址（不限 GitHub）
 * @param {string} [opts.branch] 缺省为仓库默认分支
 * @param {string} [opts.dir] 仓库内目录，默认 playlists
 * @param {{ name: string, songs: any[], json: any }[]} opts.playlists
 */
export async function syncPlaylistsGit({ repo, branch, dir = 'playlists', playlists, message }) {
  const remote = toRemoteUrl(repo)
  const files = buildRepoFiles(playlists, dir)
  let gh = null
  try { gh = parseRepo(repo) } catch (_) {}
  const repoUrl = gh ? `https://github.com/${gh.owner}/${gh.repo}` : remote

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plparse-sync-'))
  const git = (...args) => run(args, tmp)
  try {
    await run(['clone', '--depth=1', '--quiet', ...(branch ? [`--branch=${branch}`] : []), '--', remote, tmp])

    const rootNames = fs.readdirSync(tmp).map(n => n.toLowerCase())
    for (const f of files) {
      // README 只在仓库里没有时创建，不覆盖用户自己改过的
      if (f.ifMissing && rootNames.includes(f.path.toLowerCase())) continue
      const abs = path.join(tmp, ...f.path.split('/'))
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, f.content, 'utf8')
    }

    await git('add', '-A')
    const changed = (await git('-c', 'core.quotePath=false', 'diff', '--cached', '--name-only')).split('\n').filter(Boolean)
    const current = await git('symbolic-ref', '--short', 'HEAD')
    const result = { changed, branch: current, repoUrl }
    if (!changed.length) return result

    await git('commit', '--quiet', '-m', message || defaultMessage(playlists))
    await git('push', '--quiet', 'origin', `HEAD:refs/heads/${current}`)
    result.commitSha = await git('rev-parse', 'HEAD')
    if (gh) result.commitUrl = `${repoUrl}/commit/${result.commitSha}`
    return result
  } catch (err) {
    if (typeof err.stderr === 'string') throw new Error(explain(err, remote, branch))
    throw err
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 })
  }
}
