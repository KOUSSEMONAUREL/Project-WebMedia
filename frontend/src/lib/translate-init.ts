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
const CACHE_KEY = 'webmedia_trans_page'
const CDN = 'https://res.zvo.cn/translate/translate.js'
const TTL = 5 * 60 * 1000

let loaded = false
let loading: Promise<void> | null = null
let lastHash = ''
let lastLang = ''

export function getStoredLang(): LangId {
  if (typeof localStorage === 'undefined') return 'french'
  return (localStorage.getItem(STORAGE_KEY) as LangId) || 'french'
}

export function getCurrentLang(): LangId {
  return getStoredLang()
}

function pageHash(): string {
  const main = document.querySelector('main')
  if (!main) return location.pathname
  const text = main.textContent || ''
  let h = 0
  for (let i = 0; i < Math.min(text.length, 200); i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0
  }
  return location.pathname + ':' + h
}

function getCache(): Record<string, { lang: string; ts: number }> {
  try {
    return JSON.parse(sessionStorage.getItem(CACHE_KEY) || '{}')
  } catch {
    return {}
  }
}

function setCache(url: string, lang: string): void {
  try {
    const c = getCache()
    c[url] = { lang, ts: Date.now() }
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(c))
  } catch {}
}

function isCached(url: string, lang: string): boolean {
  const c = getCache()
  const entry = c[url]
  return !!entry && entry.lang === lang && Date.now() - entry.ts < TTL
}

function loadScript(): Promise<void> {
  if (loading) return loading
  loading = new Promise((resolve) => {
    if (window.translate?.version) {
      loaded = true
      resolve()
      return
    }
    const s = document.createElement('script')
    s.src = CDN
    s.async = true
    s.onload = () => { loaded = true; resolve() }
    s.onerror = () => { console.warn('[translate] CDN failed'); resolve() }
    document.head.appendChild(s)
  })
  return loading
}

function setup(t: typeof window.translate, lang: string): void {
  t.language.setLocal('french')
  t.selectLanguageTag.show = false
  t.service.use('client.edge')
}

function apply(lang: string, delay: number): void {
  const h = pageHash()
  if (lang === lastLang && h === lastHash) return
  setTimeout(() => {
    const t = window.translate
    if (!t) return
    setup(t, lang)
    t.changeLanguage(lang)
    lastLang = lang
    lastHash = h
    setCache(location.pathname, lang)
  }, delay)
}

function applyIncremental(lang: string, delay: number): void {
  const h = pageHash()
  if (lang === lastLang && h === lastHash) return
  setTimeout(() => {
    const t = window.translate
    if (!t) return
    setup(t, lang)
    t.execute()
    lastLang = lang
    lastHash = h
    setCache(location.pathname, lang)
  }, delay)
}

export async function setLanguage(lang: LangId): Promise<void> {
  if (lang === 'french') {
    localStorage.removeItem(STORAGE_KEY)
    location.reload()
    return
  }
  localStorage.setItem(STORAGE_KEY, lang)
  if (!loaded) await loadScript()
  apply(lang, loaded ? 50 : 400)
}

export function bootstrapTranslate(): void {
  const stored = getStoredLang()
  if (stored !== 'french' && !isCached(location.pathname, stored)) {
    loadScript().then(() => apply(stored, 400))
  }
  window.addEventListener('pageshow', (e) => {
    lastHash = ''
    lastLang = ''
    if (e.persisted) {
      const lang = getStoredLang()
      if (lang !== 'french' && !isCached(location.pathname, lang)) {
        loadScript().then(() => apply(lang, 400))
      }
    }
  })
  document.addEventListener('astro:after-swap', () => {
    lastHash = ''
    const lang = getStoredLang()
    if (lang === 'french') return
    if (!loaded) {
      loadScript().then(() => apply(lang, 100))
    } else {
      applyIncremental(lang, 100)
    }
  })
}
