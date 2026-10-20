# Precedent

cyberthymesia is clean work, written from these ideas rather than from anyone's
code. These are the people whose thinking it stands on. If you like this, go
read them.

## The direct line

- **Victor Taelin**: [uniichat](https://github.com/VictorTaelin/uniichat) (Apache-2.0).
  The design this project follows most closely: a chat kept forever as a
  verbatim log; a binary tree of 512-byte lines over it; a view that appends at
  its end and halves its oldest pairs in batches, so detail fades with age and
  the prompt cache survives; subagents handed the same view; `zoom` to descend.
  And [OptMem](https://github.com/VictorTaelin/OptMem): fixed-width records where
  position is identity, the age-decaying `cover`, the harness-truncation-aware
  paging, and `forget` to rebuild a bad summary.
- **Ehrlich and Blackman (Voltropy)**: [LCM: Lossless Context
  Management](https://arxiv.org/abs/2605.04050). The immutable store, summaries
  as a derived cache with provenance, three-level escalation ending in
  deterministic truncation so summarization always converges.
- **Martian Engineering**: [lossless-claw](https://github.com/Martian-Engineering/lossless-claw).
  The DAG schema with edge tables, the drill-down tool surface, scoped expansion
  grants, large-payload interception, and hard-won lessons in its issue tracker
  (never hold a write transaction across a model call).
- **Stephen Schoettler**: [hermes-lcm](https://github.com/stephenschoettler/hermes-lcm).
  The summarizer ladder with model fallback and circuit breaker, a fresh tail
  that never splits tool pairs, paged expansion, and the multi-writer SQLite
  lessons.
- **codexstar69**: [pi-lcm](https://github.com/codexstar69/pi-lcm). LCM on Pi,
  and the `session_before_compact` shape.

## Older than LLMs

- **Tobi Oetiker**: RRDtool (1999). Round-robin archives consolidated at several
  resolutions: a store of fixed size forever, detail decaying with age.
- **Mayur Datar, Aristides Gionis, Piotr Indyk, Rajeev Motwani**: *Maintaining
  Stream Statistics over Sliding Windows* (2002). Exponential histograms:
  power-of-two buckets over a stream, with proven error bounds.
- **Yixin Chen, Guozhu Dong, Jiawei Han et al.** (2002): tilted time frames in
  stream mining: recent at fine grain, old at coarse grain.
- **Ben Laurie, Adam Langley, Emilia Kasper**: [RFC 6962](https://www.rfc-editor.org/rfc/rfc6962),
  Certificate Transparency. An append-only log under a Merkle tree; our audit
  trail uses its tree hash.
- **Patrick O'Neil et al.**: *The Log-Structured Merge-Tree* (1996). Append, then
  merge into exponentially larger levels.
- **Lance Williams**: *Pyramidal Parametrics* (1983). Mipmaps: level of detail.

## Neighbours

- Howard Chen et al., *Walking Down the Memory Maze* (MemWalker, 2023): an LLM
  navigating a tree of summaries.
- Parth Sarthi et al., *RAPTOR* (2024): recursive tree summaries for retrieval.
- Charles Packer et al., *MemGPT* (2023): the OS paging metaphor.

## Cybernetics

- **W. Ross Ashby**: the law of requisite variety. A view must carry enough
  variety to regulate the work it serves.
- **Stafford Beer**: the Viable System Model and its algedonic channel, the alarm
  that bypasses the hierarchy. Pins (`<pinned>`) are that channel.
