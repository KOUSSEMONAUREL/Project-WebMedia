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

export function getStoredLang(): LangId {
  if (typeof localStorage === 'undefined') return 'french'
  return (localStorage.getItem(STORAGE_KEY) as LangId) || 'french'
}

export function getCurrentLang(): LangId {
  return getStoredLang()
}

function loadTranslateScript(): Promise<void> {
  return new Promise((resolve) => {
    if (window.translate && typeof window.translate.version === 'string') {
      resolve()
      return
    }
    const s = document.createElement('script')
    s.src = CDN
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      console.warn('[translate] CDN failed')
      resolve()
    }
    document.head.appendChild(s)
  })
}

export async function setLanguage(lang: LangId): Promise<void> {
  if (lang === 'french') {
    localStorage.removeItem(STORAGE_KEY)
    location.reload()
    return
  }
  localStorage.setItem(STORAGE_KEY, lang)
  await loadTranslateScript()
  const t = window.translate
  if (!t) return
  t.language.setLocal('french')
  t.selectLanguageTag.show = false
  t.ignore = t.ignore || {}
  t.ignore.tagname = ['ASTRO-ISLAND', 'SCRIPT', 'STYLE']
  t.service.use('client.edge')
  t.changeLanguage(lang)
  document.addEventListener('astro:after-swap', () => {
    if (t.to && t.to !== 'french') t.execute()
  })
}

export function bootstrapTranslate(): void {
  const stored = getStoredLang()
  if (stored !== 'french') {
    setLanguage(stored)
  }
}
