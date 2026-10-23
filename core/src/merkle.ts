// RFC 6962 §2.1 Merkle Tree Hash over item hashes (SPEC §6).
// Perfect subtrees of the aligned tree are hashed once and cached (the
// `mh` column of nodes); MTH(n) folds the roots of [0,n) right to left,
// which equals the RFC's largest-power-of-two split.

import { sha256 } from './util.ts'

export const EMPTY = sha256(Buffer.alloc(0))

export function leafHash(itemHash: Buffer): Buffer {
  return sha256(Buffer.concat([Buffer.from([0]), itemHash]))
}

export function nodeHash(l: Buffer, r: Buffer): Buffer {
  return sha256(Buffer.concat([Buffer.from([1]), l, r]))
}

// MTH from the perfect-subtree hashes of the roots of [0,n), largest first.
export function foldRoots(rootHashes: Buffer[]): Buffer {
  if (rootHashes.length === 0) return EMPTY
  let acc = rootHashes[rootHashes.length - 1]
  for (let k = rootHashes.length - 2; k >= 0; k--) acc = nodeHash(rootHashes[k], acc)
  return acc
}

// Reference: the RFC's recursive definition, over item hashes [0,n).
export function mthReference(itemHashes: Buffer[]): Buffer {
  const n = itemHashes.length
  if (n === 0) return EMPTY
  if (n === 1) return leafHash(itemHashes[0])
  let k = 1
  while (k * 2 < n) k *= 2
  return nodeHash(mthReference(itemHashes.slice(0, k)), mthReference(itemHashes.slice(k)))
}

// All perfect-subtree hashes from item hashes, by level: levels[l][i].
export function buildLevels(itemHashes: Buffer[]): Buffer[][] {
  const levels: Buffer[][] = [itemHashes.map(leafHash)]
  for (let l = 1; levels[l - 1].length >= 2; l++) {
    const below = levels[l - 1]
    const up: Buffer[] = []
    for (let i = 0; 2 * i + 1 < below.length; i++) up.push(nodeHash(below[2 * i], below[2 * i + 1]))
    levels.push(up)
  }
  return levels
}
