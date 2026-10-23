// Session to store stickiness. A session lives in the store chosen at its first
// contact, whatever its working directory does later (Claude Code's primary
// directory moves when the agent cd's). The choice is one line in
// <home>/sessions.tsv: harness TAB session TAB project root. First line wins.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { cythHome, projectRoot } from './project.ts'

export type SessionId = { harness: 'claude' | 'pi'; session: string }

function file(home?: string): string {
  return path.join(cythHome(home), 'sessions.tsv')
}

function clean(s: string): string {
  return s.replace(/[\t\r\n]/g, ' ')
}

export function recordedRoot(id: SessionId, home?: string): string | undefined {
  let data: string
  try {
    data = fs.readFileSync(file(home), 'utf8')
  } catch {
    return undefined
  }
  const want = `${id.harness}\t${clean(id.session)}\t`
  for (const line of data.split('\n')) if (line.startsWith(want)) return line.slice(want.length)
  return undefined
}

/**
 * The project root a session belongs to: the recorded one, else the root of
 * `cwd`, recorded now. A session id with a `/agent` suffix belongs to its parent.
 */
export function sessionRoot(id: SessionId, cwd: string, home?: string): string {
  const key = { harness: id.harness, session: id.session.split('/')[0] }
  const hit = recordedRoot(key, home)
  if (hit !== undefined) return hit
  const root = projectRoot(cwd)
  fs.mkdirSync(cythHome(home), { recursive: true })
  fs.appendFileSync(file(home), `${key.harness}\t${clean(key.session)}\t${root}\n`)
  // Another process may have recorded first; the first line is the truth.
  return recordedRoot(key, home) ?? root
}
