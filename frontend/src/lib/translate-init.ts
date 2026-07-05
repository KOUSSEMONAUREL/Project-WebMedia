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

let loaded = false
let loading: Promise<void> | null = null
let configured = false
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
  const len = text.length
  const start = text.slice(0, 100)
  const end = text.slice(Math.max(0, len - 100))
  const mid = text.slice(Math.floor(len / 2) - 50, Math.floor(len / 2) + 50)
  let h = 0
  for (const c of start + mid + end + len.toString()) {
    h = ((h << 5) - h + c.charCodeAt(0)) | 0
  }
  return location.pathname + ':' + h
}

function getCache(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(CACHE_KEY) || '{}')
  } catch {
    return {}
  }
}

function setCache(url: string, hash: string): void {
  try {
    const c = getCache()
    c[url] = hash
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(c))
  } catch {}
}

function isCached(url: string, hash: string): boolean {
  return getCache()[url] === hash
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

function configureOnce(): void {
  if (configured || !window.translate) return
  const t = window.translate
  t.language.setLocal('french')
  t.selectLanguageTag.show = false
  t.service.use('client.edge')
  configured = true
}

function execute(lang: string, delay: number): void {
  const before = pageHash()
  if (lang === lastLang && before === lastHash) return
  if (isCached(location.pathname, before)) return
  lastLang = lang
  lastHash = before
  setTimeout(() => {
    configureOnce()
    const t = window.translate
    if (!t) return
    t.to = lang
    t.execute()
    setCache(location.pathname, pageHash())
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
  execute(lang, loaded ? 50 : 400)
}

export function bootstrapTranslate(): void {
  const stored = getStoredLang()
  if (stored !== 'french') {
    loadScript().then(() => execute(stored, 400))
  }
  window.addEventListener('pageshow', (e) => {
    lastHash = ''
    lastLang = ''
    if (e.persisted) {
      const lang = getStoredLang()
      if (lang !== 'french') {
        loadScript().then(() => execute(lang, 400))
      }
    }
  })
  document.addEventListener('astro:after-swap', () => {
    lastHash = ''
    lastLang = ''
    sessionStorage.removeItem(CACHE_KEY)
    if (window.translate) {
      window.translate.nodeHistory = {}
      window.translate.nodeQueue = {}
    }
    const lang = getStoredLang()
    if (lang === 'french') return
    if (!loaded) {
      loadScript().then(() => execute(lang, 100))
    } else {
      execute(lang, 100)
    }
  })
}
