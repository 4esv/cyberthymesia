// Public types (SPEC §8).

export type NormItem = {
  harness: 'claude' | 'pi'
  session: string
  agent?: string
  uuid: string
  kind: 'user' | 'assistant' | 'tool'
  ts: string
  text: string
  tool?: { name: string; input: unknown; output: string; isError: boolean }
  thinking?: string
}

export type ViewResult = {
  block: string
  viewEnd: number
  tailStart: number
  bytes: number
  root: string
  algedonic: boolean
}

export type Status = {
  items: number
  nodes: number
  pending: number
  pins: number
  algedonic: boolean
  root: string
}

export interface Store {
  root: string
  dbPath: string
  ingest(items: NormItem[]): { added: number; lastSeq: number }
  syncClaude(transcriptPath: string): { added: number }
  syncPi(sessionPath: string): { added: number }
  backfill(opts: { claudeDir?: string; piDir?: string }): { added: number }
  seqOf(harness: string, session: string, uuid: string): number | undefined
  view(harness: string, session: string, opts?: { high?: number; tail?: number; tailStart?: number }): ViewResult
  fold(harness: string, session: string, tailStart: number): void
  zoom(ref: string): string
  search(q: string, opts?: { regex?: boolean; limit?: number }): string
  roots(): string
  pin(ref: string, reason: string): number
  unpin(id: number): void
  pins(): string
  pending(limit: number): { ref: string; prompt: string }[]
  put(ref: string, text: string): boolean
  forget(ref: string): void
  status(): Status
  verify(): { ok: boolean; problems: string[] }
  close(): void
}
