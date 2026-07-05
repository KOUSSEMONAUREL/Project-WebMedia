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
const CDN = 'https://res.zvo.cn/translate/translate.js'

let loaded = false
let loading: Promise<void> | null = null

export function getStoredLang(): LangId {
  if (typeof localStorage === 'undefined') return 'french'
  return (localStorage.getItem(STORAGE_KEY) as LangId) || 'french'
}

export function getCurrentLang(): LangId {
  return getStoredLang()
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

function apply(lang: string, delay: number): void {
  setTimeout(() => {
    const t = window.translate
    if (!t) return
    t.language.setLocal('french')
    t.selectLanguageTag.show = false
    t.service.use('client.edge')
    t.changeLanguage(lang)
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
  apply(lang, loaded ? 100 : 500)
}

export function bootstrapTranslate(): void {
  const stored = getStoredLang()
  if (stored !== 'french') {
    loadScript().then(() => apply(stored, 500))
  }
  document.addEventListener('astro:after-swap', () => {
    const lang = getStoredLang()
    if (lang === 'french') return
    if (!loaded) {
      loadScript().then(() => apply(lang, 100))
    } else {
      apply(lang, 100)
    }
  })
}
