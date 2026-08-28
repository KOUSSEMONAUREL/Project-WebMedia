// ============================================================
// engine/nextjs.ts — Next.js RSC flight extraction
// Équivalent TS de keiyoushi's NextJs.kt (extractNextJs / extractNextJsRsc)
// ============================================================

const NEXT_F_REGEX = /self\.__next_f\.push\(\s*(\[.*\])\s*\)\s*;?\s*$/s;

export function isRscObject(el: unknown): el is Record<string, unknown> {
  return !!el && typeof el === 'object' && !Array.isArray(el);
}

function isJsonObject(el: unknown): el is Record<string, unknown> {
  return isRscObject(el);
}

function isJsonArray(el: unknown): el is unknown[] {
  return Array.isArray(el);
}

function jsonPrimitiveContent(el: unknown): string | null {
  if (typeof el === 'string') return el;
  if (typeof el === 'number' || typeof el === 'boolean') return String(el);
  return null;
}

function utf8ByteWidth(ch: string): number {
  const code = ch.codePointAt(0)!;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

interface RefCaches {
  chunkCache: Map<string, string>;
  modelCache: Map<string, unknown>;
}

function resolveNextJsRefs(element: unknown, caches: RefCaches, resolving: Set<string> = new Set()): unknown {
  if (isJsonObject(element)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(element)) out[k] = resolveNextJsRefs(v, caches, resolving);
    return out;
  }
  if (isJsonArray(element)) {
    return element.map(v => resolveNextJsRefs(v, caches, resolving));
  }
  if (typeof element === 'string' && element.startsWith('$') && element.length >= 2) {
    const str = element;
    if (str === '$undefined') return null;
    if (str === '$Infinity' || str === '$-Infinity' || str === '$NaN' || str === '$-0') {
      return str.substring(1);
    }
    if (str[1] === '$') return str.substring(1); // escaped '$'
    if (str[1] === 'D') return str.substring(2); // Date -> ISO string
    if (str[1] === 'n') return str.substring(2); // BigInt -> digit string
    if (str[1] === 'Q') return resolveMapRef(str.substring(2), caches, resolving) ?? element;
    if (str[1] === 'W') return resolveSetRef(str.substring(2), caches, resolving) ?? element;
    const resolved = resolveModelRef(str.substring(1), caches, resolving);
    return resolved ?? element;
  }
  return element;
}

function resolveModelRef(reference: string, caches: RefCaches, resolving: Set<string>): unknown {
  const segments = reference.split(':');
  const id = segments[0];
  if (segments.length === 1) {
    const chunk = caches.chunkCache.get(id);
    if (chunk !== undefined) return chunk;
  }
  if (resolving.has(id)) return null;
  const guard = new Set(resolving);
  guard.add(id);
  let value: unknown = caches.modelCache.get(id);
  if (value === undefined) return null;
  for (let i = 1; i < segments.length; i++) {
    if (typeof value === 'string' && value.startsWith('$')) {
      value = resolveNextJsRefs(value, caches, guard);
    }
    value = walkRefSegment(value, segments[i]);
    if (value === null) return null;
  }
  return resolveNextJsRefs(value, caches, guard);
}

function walkRefSegment(value: unknown, segment: string): unknown {
  if (isJsonObject(value)) return value[segment];
  if (isJsonArray(value)) {
    if (
      value.length >= 4 &&
      typeof value[0] === 'string' &&
      value[0] === '$'
    ) {
      switch (segment) {
        case 'type': return value[1];
        case 'key': return value[2];
        case 'props': return value[3];
        default: {
          const idx = parseInt(segment, 10);
          return Number.isNaN(idx) ? null : value[idx];
        }
      }
    }
    const idx = parseInt(segment, 10);
    return Number.isNaN(idx) ? null : value[idx];
  }
  return null;
}

function resolveMapRef(id: string, caches: RefCaches, resolving: Set<string>): unknown {
  if (resolving.has(id)) return null;
  const guard = new Set(resolving);
  guard.add(id);
  const entries = caches.modelCache.get(id);
  if (!isJsonArray(entries)) return null;
  const resolved = resolveNextJsRefs(entries, caches, guard);
  if (!isJsonArray(resolved)) return null;
  const out: Record<string, unknown> = {};
  for (const pair of resolved) {
    if (isJsonArray(pair) && pair.length === 2) {
      const key = jsonPrimitiveContent(pair[0]) ?? String(pair[0]);
      out[key] = pair[1];
    }
  }
  return out;
}

function resolveSetRef(id: string, caches: RefCaches, resolving: Set<string>): unknown {
  if (resolving.has(id)) return null;
  const guard = new Set(resolving);
  guard.add(id);
  const values = caches.modelCache.get(id);
  if (!isJsonArray(values)) return null;
  return resolveNextJsRefs(values, caches, guard);
}

/**
 * Attempts to parse a JSON value at `start` in `body`, returning
 * `[parsed|null, endPos]`.
 */
function parseJsonAt(body: string, start: number): [unknown | null, number] {
  if (start >= body.length) return [null, start];
  let depth = 0;
  let inString = false;
  let escape = false;
  let i = start;
  let c: string;
  while (i < body.length) {
    c = body[i++];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\' && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === '{' || c === '[') {
      depth++;
      continue;
    }
    if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) {
        try {
          return [JSON.parse(body.substring(start, i)), i];
        } catch {
          return [null, i];
        }
      }
      continue;
    }
    if (depth === 0 && /\s/.test(c)) {
      try {
        return [JSON.parse(body.substring(start, i - 1)), i];
      } catch {
        return [null, i];
      }
    }
  }
  return [null, i];
}

function extractRscPayloads(
  body: string,
  chunkCache: Map<string, string>,
  modelCache: Map<string, unknown>,
): unknown[] {
  const results: unknown[] = [];
  let pos = 0;
  while (pos < body.length) {
    const colonIdx = body.indexOf(':', pos);
    if (colonIdx === -1) break;
    const id = body.substring(pos, colonIdx);
    if (id.length === 0 || !/^[0-9a-fA-F]+$/.test(id)) {
      pos++;
      continue;
    }
    pos = colonIdx + 1;
    if (pos >= body.length) break;

    if (body[pos] === 'T') {
      pos++;
      const commaIdx = body.indexOf(',', pos);
      if (commaIdx === -1) break;
      const byteLen = parseInt(body.substring(pos, commaIdx), 16);
      if (Number.isNaN(byteLen)) break;
      pos = commaIdx + 1;
      let bytes = 0;
      const start = pos;
      while (pos < body.length && bytes < byteLen) {
        bytes += utf8ByteWidth(String.fromCodePoint(body.codePointAt(pos)!));
        const cp = body.codePointAt(pos)!;
        pos += cp > 0xffff ? 2 : 1;
      }
      const chunkContent = body.substring(start, pos);
      chunkCache.set(id, chunkContent);
      try {
        results.push(JSON.parse(chunkContent));
      } catch {
        // ignore malformed binary chunk
      }
    } else {
      const [element, end] = parseJsonAt(body, pos);
      if (element !== null) {
        results.push(element);
        modelCache.set(id, element);
      }
      pos = end;
    }
  }
  return results;
}

function extractValueNextJs(payload: unknown, predicate: (el: unknown) => boolean): unknown {
  if (!isJsonObject(payload) && !isJsonArray(payload)) return null;
  if (predicate(payload)) return payload;
  const children: unknown[] = isJsonObject(payload)
    ? Object.values(payload)
    : payload;
  for (const child of children) {
    const result = extractValueNextJs(child, predicate);
    if (result !== null) return result;
  }
  return null;
}

function extractScriptPayloads(
  html: string,
  chunkCache: Map<string, string>,
  modelCache: Map<string, unknown>,
): unknown[] {
  const results: unknown[] = [];
  const scriptRe = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html))) {
    if (/\bsrc\s*=/.test(m[1])) continue;
    const script = m[2];
    if (!script.includes('self.__next_f.push')) continue;
    const am = NEXT_F_REGEX.exec(script);
    if (!am) continue;
    try {
      const arr = JSON.parse(am[1]);
      const content = arr[1];
      if (typeof content !== 'string') continue;
      results.push(...extractRscPayloads(content, chunkCache, modelCache));
    } catch {
      // skip malformed script
    }
  }
  return results;
}

/**
 * Extracts the first nested element satisfying `predicate` from a Next.js
 * page — either an HTML document (App Router `self.__next_f.push` scripts
 * or Pages Router `#__NEXT_DATA__`) or a raw RSC `text/x-component` body.
 */
export function extractNextJs(body: string, predicate: (el: unknown) => boolean): unknown {
  const chunkCache = new Map<string, string>();
  const modelCache = new Map<string, unknown>();
  let payloads: unknown[];

  if (body.startsWith('<')) {
    payloads = extractScriptPayloads(body, chunkCache, modelCache);
    if (payloads.length === 0) {
      const m = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/g.exec(body);
      if (m) {
        try {
          const root = JSON.parse(m[1]);
          payloads.push(root);
        } catch {
          // ignore
        }
      }
    }
  } else {
    payloads = extractRscPayloads(body, chunkCache, modelCache);
  }

  for (const payload of payloads) {
    const resolved = resolveNextJsRefs(payload, { chunkCache, modelCache });
    const result = extractValueNextJs(resolved, predicate);
    if (result !== null) return result;
  }
  return null;
}