import { useEffect, useState, useSyncExternalStore } from 'react';

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

async function viaBackend(text: string, lang: LangId): Promise<string | null> {
  const base = ((import.meta as any).env?.PUBLIC_API_URL || 'http://localhost:8787').replace(/\/+$/, '')
  const url = `${base}/api/translate?tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(text)}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`backend ${r.status}`)
  const j: any = await r.json()
  if (typeof j?.translated !== 'string' || !j.translated.trim()) throw new Error('backend payload')
  return j.translated
}

async function viaMyMemory(text: string, lang: LangId): Promise<string | null> {
  const code = GOOGLE_CODE[lang] || 'en'
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(`fr|${code}`)}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`mymemory ${r.status}`)
  const j: any = await r.json()
  const out = j?.responseData?.translatedText
  if (typeof out !== 'string' || !out.trim()) throw new Error('mymemory payload')
  return decodeEntities(out)
}

async function fetchTranslate(text: string, lang: LangId): Promise<string> {
  const k = `${lang}:${text}`
  if (memo.has(k)) return memo.get(k)!
  try {
    const ls = localStorage.getItem(`wmt:${k}`)
    if (ls) {
      memo.set(k, ls)
      return ls
    }
  } catch {}

  let out = text
  try {
    out = (await viaBackend(text, lang)) ?? text
  } catch {
    try {
      out = (await viaMyMemory(text, lang)) ?? text
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
  const [out, setOut] = useState(text)
  useEffect(() => {
    let alive = true
    if (lang === 'french') {
      setOut(text)
      return
    }
    fetchTranslate(text, lang).then((v) => {
      if (alive) setOut(v)
    })
    return () => {
      alive = false
    }
  }, [text, lang])
  return out
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
