// The algedonic channel (SPEC §5): pins that never decay.

import { keyArg, toolOk, type ItemRow } from './leaves.ts'
import { PIN_BYTES, PIN_CLIP, bytes, clipMark, oneLine } from './util.ts'

export type PinKind = 'directive' | 'failure' | 'manual'
export type PinRow = { id: number; seq: number; reason: string; kind: PinKind; key: string | null }

// After a sentence-initial always/never, a word that shows the sentence is not an
// imperative: "Always been interested", "Never mind", "Always good to hear".
const NOT_VERB = "(?:been|being|good|great|fun|nice|cool|up|down|here|there|so|such|a|an|the|my|your|our|his|her|their|its|this|that|glad|happy|ready|more|less|too|really|just|mind|ever|once|again|enough|any|sure|easy|hard|better|best|worse|knew|thought|felt|had|was|were|did|got|said|saw|heard|went|came|made|took|is|are|am|by|with|in|on|at|for|love|like)\\b|[a-z]+(?:ing|ed)\\b"
// A clause that states someone's own plan, not an order: "I'll", "he will", "I'm going to", "I hope".
const SELF = "['\u2019]ll|\\s+will|\\s+(?:hope|plan)|['\u2019]m\\s+(?:\\w+\\s+){0,2}(?:going|hoping|trying|planning)|\\s+am\\s+(?:\\w+\\s+){0,2}(?:going|hoping|trying|planning)"
const SO = "(?:always|never|don['\u2019]t ever|do not ever)"
// A standing order addressed to the assistant (SPEC §5), not a standing-order
// word anywhere: "I've always stayed away" and "I'm always down for movies"
// narrate, "Never push to main" and "from now on use tabs" instruct. Each
// pattern is one sentence-level construction; any one is enough.
const STANDING: RegExp[] = [
  // An imperative: the sentence starts with the order word and a verb.
  new RegExp(`^(?:(?:please|and|also|so|but|just|ok|okay)[,]?\\s+)*${SO}\\s+(?!${NOT_VERB})[a-z]+\\b`, 'i'),
  /\bplease\s+(?:always|never)\b/i,
  // "from now on" as an order, not the speaker's own resolution ("I'll recycle from now on").
  new RegExp(`^(?!.*\\b(?:I|he|she|they|it)(?:${SELF})\\b).*\\b(?:from now on|going forward|from here on)\\b`, 'i'),
  /\b(?:you|we)\s+(?:should|must|need to|have to|are to)\s+(?:always|never)\b/i,
  /\bmake sure (?:that )?(?:you|we|to)\s+(?:always|never)\b/i,
  /\bwant you to\s+(?:always|never)\b/i,
  /\blet['\u2019]?s\s+(?:always|never)\b/i,
  /\b(?:I|we)\s+(?:almost\s+)?(?:always|never|don['\u2019]t ever|do not ever)\s+(?:want|prefer)\b/i,
  /\bour (?:standard|rule|convention|policy|default)s?\s+(?:is|are)\b/i,
  /\bwe(?:['\u2019]re| are)\s+(?:trying|aiming|going)\s+to\b[^.!?\n]*\b(?:always|never)\b/i,
]
// Text with quoted spans and code removed: a standing-order word inside a quote
// or code is being talked about, not given.
export function unquoted(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/"[^"\n]*"/g, ' ')
    .replace(/\u201c[^\u201d\n]*\u201d/g, ' ')
    .replace(/(^|[\s(\[])'[^'\n]*'(?=[\s.,;:!?)\]]|$)/g, '$1 ')
}

// A user item pins as a directive only when a human said it in an interactive
// session (not a one-shot -p run, not a subagent prompt) and a non-question
// sentence is a standing order (one of STANDING).
export function isDirective(item: ItemRow, oneShot = false): boolean {
  if (item.kind !== 'user' || oneShot || item.agent !== null || [...item.text].length > 1000) return false
  return unquoted(item.text)
    .split(/(?<=[.!?\n])/)
    .map((s) => s.trim())
    .some((s) => s !== '' && !s.endsWith('?') && STANDING.some((re) => re.test(s)))
}

// The failure key and status of a tool item (SPEC §5): a failure is open per
// (harness, session, agent, tool name) until a later call of that tool succeeds.
export function toolKey(item: ItemRow): { key: string; ok: boolean } | null {
  if (item.kind !== 'tool' || item.meta === null) return null
  const ok = toolOk(item.text, item.meta.isError)
  return { key: `${item.harness}\0${item.session}\0${item.agent ?? ''}\0${item.meta.name.toLowerCase()}`, ok }
}

export function pinText(item: ItemRow): string {
  if (item.kind === 'tool' && item.meta !== null) {
    const ok = toolOk(item.text, item.meta.isError)
    const k = keyArg(item.meta.name, item.meta.input, item.text, ok)
    return clipMark(oneLine(`${item.meta.name} ${k.display} → ${ok ? 'ok' : 'ERR'}: ${item.text}`), PIN_CLIP)
  }
  return clipMark(oneLine(item.text), PIN_CLIP)
}

// Pins oldest first. The newest pins show their text while the total fits
// PIN_BYTES; that pin and every older one show as refs only.
export function renderPins(pins: { pin: PinRow; text: string }[]): { block: string; over: number } {
  if (pins.length === 0) return { block: '', over: 0 }
  const full = new Array<boolean>(pins.length).fill(false)
  let used = 0
  for (let k = pins.length - 1; k >= 0; k--) {
    const b = bytes(pins[k].text)
    if (used + b > PIN_BYTES) break
    used += b
    full[k] = true
  }
  const over = full.filter((f) => !f).length
  const lines: string[] = []
  if (over > 0) lines.push(`ALGEDONIC: ${over} pins over quota; review with memory_pins`)
  pins.forEach(({ pin, text }, k) => {
    const head = `[${pin.id}] #${pin.seq} ${pin.kind}: ${clipMark(oneLine(pin.reason), 200)}`
    lines.push(full[k] ? `${head} | ${text}` : `${head} (over quota: memory_zoom #${pin.seq})`)
  })
  return { block: '<pinned>\n' + lines.join('\n') + '\n</pinned>\n', over }
}
