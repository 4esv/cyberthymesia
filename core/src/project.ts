// Project root and store path (SPEC §1).

import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

function real(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}

function nearestExisting(p: string): string {
  let d = path.resolve(p)
  while (!fs.existsSync(d)) {
    const up = path.dirname(d)
    if (up === d) return d
    d = up
  }
  return d
}

const cache = new Map<string, string>()

// Parent of the git common dir (worktrees share it), else the cwd. A cwd that
// no longer exists (a deleted worktree) resolves through its nearest existing
// ancestor's repo; with no repo there, the cwd itself.
export function projectRoot(cwd: string): string {
  const abs = path.resolve(cwd)
  const hit = cache.get(abs)
  if (hit !== undefined) return hit
  const at = nearestExisting(abs)
  let root = fs.existsSync(abs) ? real(abs) : abs
  try {
    const dir = fs.statSync(at).isDirectory() ? at : path.dirname(at)
    const out = execFileSync('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim()
    if (out !== '') root = path.dirname(real(out))
  } catch {
    // not a repo: the cwd
  }
  cache.set(abs, root)
  return root
}

export function slugOf(root: string): string {
  return root.replace(/\//g, '-').replace(/^-+/, '')
}

export function cythHome(home?: string): string {
  return home ?? process.env.CYTH_HOME ?? path.join(os.homedir(), '.cyberthymesia')
}

export function storePath(root: string, home?: string): string {
  return path.join(cythHome(home), slugOf(root), 'store.db')
}
