import * as cheerio from 'cheerio';

// Type-safe JSON value used to walk React Server Components (RSC) flight payloads.
export type Json = null | boolean | number | string | Json[] | JsonObject;

export interface JsonObject {
  [key: string]: Json;
}

export type NextJsPredicate = (value: Json) => boolean;

const NEXT_F_REGEX = /self\.__next_f\.push\(\s*(\[.*])\s*\)\s*;?\s*$/s;

const HEX_RE = /^[0-9a-fA-F]+$/;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ------------------------------------------------------------
// RSC payload extraction
// ------------------------------------------------------------

/**
 * Parses a raw RSC (React Server Components) flight response body and returns the
 * first nested JSON value that fulfills the given predicate, or null.
 *
 * The flight body is a sequence of `[<hex>]:<value>` rows. Binary chunks are
 * prefixed with `T` and carry their UTF-8 byte length: `T<len>,<content>`.
 */
export function extractNextJsRsc(body: string, predicate: NextJsPredicate): Json | null {
  const chunkCache = new Map<string, string>();
  const modelCache = new Map<string, Json>();
  const payloads = extractRscPayloads(body, chunkCache, modelCache);
  return findMatchingValue(payloads, chunkCache, modelCache, predicate);
}

/**
 * Extracts Next.js hydrated flight data from an HTML document (App Router
 * `self.__next_f.push` scripts, with a Pages Router `#__NEXT_DATA__` fallback)
 * and returns the first nested JSON value fulfilling the predicate, or null.
 */
export function extractNextJsHtml(html: string, predicate: NextJsPredicate): Json | null {
  const chunkCache = new Map<string, string>();
  const modelCache = new Map<string, Json>();
  const appPayloads = extractAppRouterPayloads(html, chunkCache, modelCache);
  const payloads = appPayloads.length > 0 ? appPayloads : extractPagesRouterPayloads(html);
  return findMatchingValue(payloads, chunkCache, modelCache, predicate);
}

function findMatchingValue(
  payloads: Json[],
  chunkCache: Map<string, string>,
  modelCache: Map<string, Json>,
  predicate: NextJsPredicate,
): Json | null {
  for (const payload of payloads) {
    const resolved = resolveNextJsRefs(payload, chunkCache, modelCache);
    const value = extractValueNextJs(resolved, predicate);
    if (value !== null) return value;
  }
  return null;
}

/**
 * Recursively walks the JSON tree and returns the first element that fulfills
 * the predicate. Only objects and arrays are evaluated as candidates.
 */
function extractValueNextJs(payload: Json, predicate: NextJsPredicate): Json | null {
  if ((isJsonObject(payload) || Array.isArray(payload)) && predicate(payload)) return payload;
  if (isJsonObject(payload)) {
    for (const key of Object.keys(payload)) {
      const result = extractValueNextJs(payload[key], predicate);
      if (result !== null) return result;
    }
    return null;
  }
  if (Array.isArray(payload)) {
    for (const child of payload) {
      const result = extractValueNextJs(child, predicate);
      if (result !== null) return result;
    }
    return null;
  }
  return null;
}

// ------------------------------------------------------------
// Reference resolution
// ------------------------------------------------------------

/**
 * Recursively resolves React Flight reference markers:
 * - `$$` esc done string (drops first `$`)
 * - `$undefined` -> JS undefined, resolved to JSON null
 * - `$D<iso>` -> Date, drops `$D` to expose the ISO-8601 string
 * - `$n<digits>` -> BigInt, drops `$n` to expose the digit string
 * - `$Infinity` / `$-Infinity` / `$NaN` / `$-0` -> drops `$`
 * - `$Q<id>` -> Map outlined model (array of [key, value] pairs)
 * - `$W<id>` -> Set outlined model (array of values)
 * - `$<id>` / `$<id>:<path>` -> outlined model reference, walked via chunk/model caches
 */
function resolveNextJsRefs(
  element: Json,
  chunkCache: Map<string, string>,
  modelCache: Map<string, Json>,
  resolving: Set<string> = new Set(),
): Json {
  if (isJsonObject(element)) {
    const out: JsonObject = {};
    for (const key of Object.keys(element)) {
      out[key] = resolveNextJsRefs(element[key], chunkCache, modelCache, resolving);
    }
    return out;
  }
  if (Array.isArray(element)) {
    return element.map(child => resolveNextJsRefs(child, chunkCache, modelCache, resolving));
  }
  if (typeof element === 'string' && element.startsWith('$') && element.length >= 2) {
    const str = element;
    if (str === '$undefined') return null;
    if (str === '$Infinity' || str === '$-Infinity' || str === '$NaN' || str === '$-0') {
      return str.substring(1);
    }
    const marker = str[1];
    if (marker === '$') return str.substring(1);
    if (marker === 'D' || marker === 'n') return str.substring(2);
    if (marker === 'Q') return resolveMapRef(str.substring(2), chunkCache, modelCache, resolving) ?? element;
    if (marker === 'W') return resolveSetRef(str.substring(2), chunkCache, modelCache, resolving) ?? element;
    return resolveModelRef(str.substring(1), chunkCache, modelCache, resolving) ?? element;
  }
  return element;
}

/** Resolves a flight reference `<id>` or `<id>:<seg>:<seg>...` into the referenced element. */
function resolveModelRef(
  reference: string,
  chunkCache: Map<string, string>,
  modelCache: Map<string, Json>,
  resolving: Set<string>,
): Json | null {
  const segments = reference.split(':');
  const id = segments[0];
  if (segments.length === 1) {
    const chunk = chunkCache.get(id);
    if (chunk !== undefined) return chunk;
  }
  if (resolving.has(id)) return null;
  const guard = new Set(resolving);
  guard.add(id);
  const model = modelCache.get(id);
  if (model === undefined) return null;
  let value: Json = model;
  for (let i = 1; i < segments.length; i++) {
    if (typeof value === 'string' && value.startsWith('$')) {
      value = resolveNextJsRefs(value, chunkCache, modelCache, guard);
    }
    const stepped = walkRefSegment(value, segments[i]);
    if (stepped === null) return null;
    value = stepped;
  }
  return resolveNextJsRefs(value, chunkCache, modelCache, guard);
}

/** Indexes a JSON value by a single path segment, honouring React element tuples. */
function walkRefSegment(value: Json, segment: string): Json | null {
  if (isJsonObject(value)) {
    const v = value[segment];
    return v === undefined ? null : v;
  }
  if (Array.isArray(value)) {
    if (value.length >= 4 && value[0] === '$') {
      switch (segment) {
        case 'type': return value[1];
        case 'key': return value[2];
        case 'props': return value[3];
        default: {
          const idx = Number(segment);
          if (!Number.isInteger(idx) || idx < 0) return null;
          return value[idx] ?? null;
        }
      }
    }
    const idx = Number(segment);
    if (!Number.isInteger(idx) || idx < 0) return null;
    return value[idx] ?? null;
  }
  return null;
}

/** Resolves an outlined model at `<id>` (a row of [key, value] pairs) into an object. */
function resolveMapRef(
  id: string,
  chunkCache: Map<string, string>,
  modelCache: Map<string, Json>,
  resolving: Set<string>,
): Json | null {
  if (resolving.has(id)) return null;
  const entries = modelCache.get(id);
  if (!Array.isArray(entries)) return null;
  const guard = new Set(resolving);
  guard.add(id);
  const resolved = resolveNextJsRefs(entries, chunkCache, modelCache, guard);
  if (!Array.isArray(resolved)) return null;
  const out: JsonObject = {};
  for (const entry of resolved) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const key = typeof entry[0] === 'string' ? entry[0] : JSON.stringify(entry[0]);
    out[key] = entry[1];
  }
  return out;
}

/** Resolves an outlined model at `<id>` (a row of values) into an array. */
function resolveSetRef(
  id: string,
  chunkCache: Map<string, string>,
  modelCache: Map<string, Json>,
  resolving: Set<string>,
): Json | null {
  if (resolving.has(id)) return null;
  const values = modelCache.get(id);
  if (!Array.isArray(values)) return null;
  const guard = new Set(resolving);
  guard.add(id);
  return resolveNextJsRefs(values, chunkCache, modelCache, guard);
}

// ------------------------------------------------------------
// Flight payload parsing
// ------------------------------------------------------------

function extractRscPayloads(
  body: string,
  chunkCache: Map<string, string>,
  modelCache: Map<string, Json>,
): Json[] {
  const results: Json[] = [];
  let pos = 0;

  while (pos < body.length) {
    const colonIdx = body.indexOf(':', pos);
    if (colonIdx === -1) break;

    const id = body.substring(pos, colonIdx);
    if (id.length === 0 || !HEX_RE.test(id)) {
      pos++;
      continue;
    }

    pos = colonIdx + 1;
    if (pos >= body.length) break;

    if (body[pos] === 'T') {
      pos++;
      const commaIdx = body.indexOf(',', pos);
      if (commaIdx === -1) break;
      const byteLenText = body.substring(pos, commaIdx);
      if (!HEX_RE.test(byteLenText)) break;
      const byteLen = parseInt(byteLenText, 16);
      pos = commaIdx + 1;
      let bytes = 0;
      const start = pos;
      while (pos < body.length && bytes < byteLen) {
        const code = body.charCodeAt(pos);
        if (code < 0x80) {
          bytes += 1;
        } else if (code < 0x800) {
          bytes += 2;
        } else if (code >= 0xd800 && code <= 0xdbff) {
          bytes += 4;
          pos += 1;
        } else {
          bytes += 3;
        }
        pos++;
      }
      const chunkContent = body.substring(start, pos);
      chunkCache.set(id, chunkContent);
      try {
        results.push(JSON.parse(chunkContent) as Json);
      } catch {
        // Malformed chunk: keep position, ignore content.
      }
    } else {
      const parsed = parseJsonAt(body, pos);
      if (parsed.element !== null) {
        results.push(parsed.element);
        modelCache.set(id, parsed.element);
      }
      pos = parsed.end;
    }
  }

  return results;
}

/** Parses a JSON value at [start], returning it and the position right after it ends. */
function parseJsonAt(body: string, start: number): { element: Json | null; end: number } {
  if (start >= body.length) return { element: null, end: start };

  let depth = 0;
  let inString = false;
  let escape = false;
  let i = start;

  while (i < body.length) {
    const c = body[i++];
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
          return { element: JSON.parse(body.substring(start, i)) as Json, end: i };
        } catch {
          return { element: null, end: i };
        }
      }
      continue;
    }
    if (depth === 0 && /\s/.test(c)) {
      try {
        return { element: JSON.parse(body.substring(start, i - 1)) as Json, end: i };
      } catch {
        return { element: null, end: i };
      }
    }
  }
  return { element: null, end: i };
}

function extractAppRouterPayloads(
  html: string,
  chunkCache: Map<string, string>,
  modelCache: Map<string, Json>,
): Json[] {
  const doc = cheerio.load(html);
  const results: Json[] = [];
  const scripts = doc('script:not([src])').toArray();
  for (const script of scripts) {
    const data = doc(script).text();
    if (!data.includes('self.__next_f.push')) continue;
    try {
      const match = NEXT_F_REGEX.exec(data);
      if (!match || !match[1]) continue;
      const arr = JSON.parse(match[1]) as Json;
      if (!Array.isArray(arr)) continue;
      const content = arr[1];
      if (typeof content !== 'string') continue;
      results.push(...extractRscPayloads(content, chunkCache, modelCache));
    } catch {
      // Ignore malformed push blocks.
    }
  }
  return results;
}

function extractPagesRouterPayloads(html: string): Json[] {
  const doc = cheerio.load(html);
  const data = doc('#__NEXT_DATA__').first().text();
  if (!data) return [];
  try {
    const root = JSON.parse(data) as Json;
    const out: Json[] = [];
    if (isJsonObject(root)) {
      const props = root.props;
      if (isJsonObject(props)) {
        const pageProps = props.pageProps;
        if (pageProps !== undefined) out.push(pageProps);
      }
    }
    out.push(root);
    return out;
  } catch {
    return [];
  }
}