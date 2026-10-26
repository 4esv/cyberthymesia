// Near-spelling fallback for search. When the exact FTS query finds fewer
// than FEW hits, each query word is widened to itself OR up to NEAR words of
// the index within a small edit distance ("balnce" finds "balance", "licence"
// finds "license"), and at most EXTRA new hits are added. Measured on 37
// agent-labelled cases over copies of two real stores (2026-10-25, tuned on
// the same set): recall@5 0.43 → 0.70 at 1.38× the output bytes. If hits are
// still under FEW, search fills the rest of EXTRA with hits that match only
// some of the words (orQuery): recall@5 0.89 at 2.7× the V0 bytes.

export const FEW = 5
export const NEAR = 3
export const EXTRA = 3

// Edit distance with adjacent swaps (optimal string alignment); returns
// max + 1 as soon as the distance must exceed max.
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let p2: number[] | null = null
  let p1 = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const c = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(p1[j] + 1, c[j - 1] + 1, p1[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (p2 !== null && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1)
      c.push(v)
      if (v < best) best = v
    }
    if (best > max) return max + 1
    p2 = p1
    p1 = c
  }
  return p1[b.length]
}

// Short words are not widened: at 3 letters one edit reaches too many words.
export const maxEdit = (t: string): number => (t.length < 4 ? 0 : t.length < 8 ? 1 : 2)

// The query's words as the default FTS index splits them, or null when the
// query uses FTS syntax (quotes, *, ^, :, parens, AND/OR/NOT/NEAR), whose
// meaning a rewrite would change.
export function plainWords(q: string): string[] | null {
  if (/["*^:()]/.test(q) || /(^|\s)(AND|OR|NOT|NEAR)(\s|$)/.test(q)) return null
  return q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

// Up to NEAR index words within maxEdit of t, most documents first. Only
// letter words are widened, and a neighbour must share t's first letter, so
// the vocab read is one cheap range of FTS5's term index.
export function nearWords(vocab: { term: string; doc: number }[], t: string): string[] {
  const d = maxEdit(t)
  if (d === 0 || !/^\p{L}+$/u.test(t)) return []
  const out: { term: string; doc: number }[] = []
  for (const v of vocab) {
    if (v.term === t || Math.abs(v.term.length - t.length) > d) continue
    if (firstLetter(v.term) !== firstLetter(t)) continue
    if (editDistance(t, v.term, d) <= d) out.push(v)
  }
  out.sort((a, b) => b.doc - a.doc || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
  return out.slice(0, NEAR).map((v) => v.term)
}

export const firstLetter = (t: string): string => String.fromCodePoint(t.codePointAt(0) ?? 0)
// The term range [lo, hi) of words starting with t's first letter.
export function letterRange(t: string): [string, string] {
  const c = t.codePointAt(0) ?? 0
  return [String.fromCodePoint(c), String.fromCodePoint(c + 1)]
}

const quote = (t: string) => '"' + t.replace(/"/g, '""') + '"'
// AND over words, each word OR its neighbours.
export const widenedQuery = (groups: string[][]): string => groups.map((g) => '(' + g.map(quote).join(' OR ') + ')').join(' AND ')

// Any of the words or their neighbours, each once; bm25 ranks hits with more
// of them higher.
export const orQuery = (groups: string[][]): string => [...new Set(groups.flat())].map(quote).join(' OR ')
