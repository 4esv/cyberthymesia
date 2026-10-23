// The algedonic channel (SPEC §5): pins that never decay.

import { keyArg, toolOk, type ItemRow } from './leaves.ts'
import { PIN_BYTES, PIN_CLIP, bytes, clipMark, oneLine } from './util.ts'

export type PinKind = 'directive' | 'failure' | 'manual'
export type PinRow = { id: number; seq: number; reason: string; kind: PinKind; key: string | null }

const DIRECTIVE = /\b(never|always|don't|do not|must|stop|remember|from now on)\b/i

export function isDirective(item: ItemRow): boolean {
  if (item.kind !== 'user' || [...item.text].length > 1000) return false
  return item.text
    .split(/(?<=[.!?\n])/)
    .map((s) => s.trim())
    .some((s) => s !== '' && !s.endsWith('?') && DIRECTIVE.test(s))
}

// The normalized key and status of a tool item, for failure pins.
export function toolKey(item: ItemRow): { key: string; ok: boolean } | null {
  if (item.kind !== 'tool' || item.meta === null) return null
  const ok = toolOk(item.text, item.meta.isError)
  return { key: keyArg(item.meta.name, item.meta.input, item.text, ok).norm, ok }
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
