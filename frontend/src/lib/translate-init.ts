import { useEffect, useState, useSyncExternalStore } from 'react';
import { getOverride } from './translate-overrides';

export const SUPPORTED_LANGS = [
  { id: 'french', label: 'Francais' },
  { id: 'english', label: 'English' },
  { id: 'spanish', label: 'Espanol' },
  { id: 'german', label: 'Deutsch' },
  { id: 'italian', label: 'Italiano' },
  { id: 'portuguese', label: 'Portugues' },
  { id: 'japanese', label: '日本語' },
  { id: 'korean', label: '한국어' },
  { id: 'chinese_simplified', label: '简体中文' },
  { id: 'russian', label: 'Русский' },
  { id: 'arabic', label: 'العربية' },
  { id: 'dutch', label: 'Nederlands' },
  { id: 'polish', label: 'Polski' },
  { id: 'turkish', label: 'Turkce' },
  { id: 'swedish', label: 'Svenska' },
]

type LangId = (typeof SUPPORTED_LANGS)[number]['id']

const STORAGE_KEY = 'webmedia_lang'

const GOOGLE_CODE: Record<LangId, string> = {
  french: 'fr',
  english: 'en',
  spanish: 'es',
  german: 'de',
  italian: 'it',
  portuguese: 'pt',
  japanese: 'ja',
  korean: 'ko',
  chinese_simplified: 'zh-CN',
  russian: 'ru',
  arabic: 'ar',
  dutch: 'nl',
  polish: 'pl',
  turkish: 'tr',
  swedish: 'sv',
}

const listeners = new Set<() => void>()
function emitLang() {
  listeners.forEach((l) => l())
}

function subscribeLang(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function getLangSnapshot(): LangId {
  return getStoredLang()
}

function getLangServerSnapshot(): LangId {
  return 'french'
}

export function useLang(): LangId {
  return useSyncExternalStore(subscribeLang, getLangSnapshot, getLangServerSnapshot)
}

function hasStoredLang(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null
}

export function getStoredLang(): LangId {
  if (typeof localStorage === 'undefined') return 'french'
  return (localStorage.getItem(STORAGE_KEY) as LangId) || 'french'
}

export function getCurrentLang(): LangId {
  return getStoredLang()
}

const memo = new Map<string, string>()

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
}

function decodeEntities(input: string): string {
  return input.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
}

function sanitize(input: string): string {
  return decodeEntities(
    input
      .replace(/<[^>]*>/g, '')
      .replace(/&[a-z]+;|&#\d+;/gi, '')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

async function viaGoogle(text: string, lang: LangId): Promise<string | null> {
  const code = GOOGLE_CODE[lang] || 'en'
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=fr&tl=${encodeURIComponent(code)}&dt=t&q=${encodeURIComponent(text)}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`google ${r.status}`)
  const j: any = await r.json()
  if (!Array.isArray(j?.[0])) throw new Error('google payload')
  const out = sanitize(j[0].map((x: any) => x?.[0] ?? '').join(''))
  if (!out) throw new Error('google empty')
  return out
}

async function viaBackend(text: string, lang: LangId): Promise<string | null> {
  const base = ((import.meta as any).env?.PUBLIC_API_URL || 'http://localhost:8787').replace(/\/+$/, '')
  const url = `${base}/api/translate?tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(text)}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`backend ${r.status}`)
  const j: any = await r.json()
  if (typeof j?.translated !== 'string' || !j.translated.trim()) throw new Error('backend payload')
  const out = sanitize(j.translated)
  if (!out) throw new Error('backend empty')
  return out
}

async function viaMyMemory(text: string, lang: LangId): Promise<string | null> {
  const code = GOOGLE_CODE[lang] || 'en'
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(`fr|${code}`)}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`mymemory ${r.status}`)
  const j: any = await r.json()
  const raw = j?.responseData?.translatedText
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('mymemory payload')
  const out = sanitize(raw)
  if (!out) throw new Error('mymemory empty')
  return out
}

async function fetchTranslate(text: string, lang: LangId): Promise<string> {
  const fixed = getOverride(lang, text)
  if (fixed) return fixed
  const k = `${lang}:${text}`
  if (memo.has(k)) return memo.get(k)!
  try {
    const ls = localStorage.getItem(`wmt:${k}`)
    if (ls) {
      memo.set(k, ls)
      return ls
    }
  } catch {}

  const engines = [viaGoogle, viaBackend, viaMyMemory]
  let out = text
  for (const engine of engines) {
    try {
      const got = await engine(text, lang)
      if (got && got.trim()) {
        out = got
        break
      }
    } catch {}
  }
  memo.set(k, out)
  try {
    localStorage.setItem(`wmt:${k}`, out)
  } catch {}
  return out
}

export function useT(text: string): string {
  const lang = useLang()
  const fixed = lang === 'french' ? undefined : getOverride(lang, text)
  const [out, setOut] = useState(() => fixed ?? text)
  useEffect(() => {
    let alive = true
    if (lang === 'french') {
      setOut(text)
      return
    }
    if (fixed) {
      setOut(fixed)
      return
    }
    fetchTranslate(text, lang).then((v) => {
      if (alive) setOut(v)
    })
    return () => {
      alive = false
    }
  }, [text, lang, fixed])
  return fixed ?? out
}

export async function setLanguage(lang: LangId): Promise<void> {
  localStorage.setItem(STORAGE_KEY, lang)
  emitLang()
}

let bootstrapped = false

export function bootstrapTranslate(): void {
  if (bootstrapped) return
  bootstrapped = true
  try {
    sessionStorage.removeItem('webmedia_trans_page')
  } catch {}
  if (!hasStoredLang()) {
    localStorage.setItem(STORAGE_KEY, 'french')
  }
}
