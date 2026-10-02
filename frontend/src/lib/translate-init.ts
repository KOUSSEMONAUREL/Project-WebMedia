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
  const base = ((import.meta as any).env?.PUBLIC_API_URL || 'http://localhost:8787').replace(/\/+$/, '')
  const url = `${base}/api/translate?tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(text)}`
  let out = text
  try {
    const r = await fetch(url)
    const j: any = await r.json()
    if (j?.translated) out = j.translated
  } catch {}
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
