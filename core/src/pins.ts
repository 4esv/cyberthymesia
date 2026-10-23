// The algedonic channel (SPEC §5): pins that never decay.

import { keyArg, toolOk, type ItemRow } from './leaves.ts'
import { PIN_BYTES, PIN_CLIP, bytes, clipMark, oneLine } from './util.ts'

export type PinKind = 'directive' | 'failure' | 'manual'
export type PinRow = { id: number; seq: number; reason: string; kind: PinKind; key: string | null }

// Explicit standing-order language only (SPEC §5). Whole words, any case.
const DIRECTIVE = /\b(always|never|from now on|don['\u2019]t ever|do not ever|remember that|every time)\b/i

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
// sentence carries standing-order language.
export function isDirective(item: ItemRow, oneShot = false): boolean {
  if (item.kind !== 'user' || oneShot || item.agent !== null || [...item.text].length > 1000) return false
  return unquoted(item.text)
    .split(/(?<=[.!?\n])/)
    .map((s) => s.trim())
    .some((s) => s !== '' && !s.endsWith('?') && DIRECTIVE.test(s))
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
