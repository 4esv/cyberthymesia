# cyberthymesia

Every chat goes forever. The context window becomes a cache over a lossless,
auditable log: the model sees a small fixed header (pins and the newest items)
and searches the full verbatim record when it needs anything older. No model
summarizes the log. One store per project, shared by every session of every
harness.

- `core/`: the store, the tree, the view, search, zoom, pins and the audit trail. Node ≥ 22, zero dependencies.
- `claude-code/`: the Claude Code mod.
- `pi/`: the Pi extension.

The design is in [SPEC.md](SPEC.md). The people it stands on are in
[PRECEDENT.md](PRECEDENT.md).

Status: v0, being dogfooded.

Apache-2.0.
