const TRANSLATE_CDN = 'https://cdn.staticfile.net/translate.js/4.0.0/translate.js'

export const LANG_MAP: Record<string, string> = {
  fr: 'french',
  en: 'english',
  es: 'spanish',
  de: 'german',
  it: 'italian',
  pt: 'portuguese',
  ja: 'japanese',
  ko: 'korean',
  zh: 'chinese_simplified',
  ru: 'russian',
  ar: 'arabic',
  nl: 'dutch',
  pl: 'polish',
  tr: 'turkish',
  sv: 'swedish',
  da: 'danish',
  fi: 'finnish',
  no: 'norwegian',
  cs: 'czech',
  ro: 'romanian',
  hu: 'hungarian',
  el: 'greek',
  he: 'hebrew',
  th: 'thai',
  vi: 'vietnamese',
  hi: 'hindi',
  id: 'indonesian',
  ms: 'malay',
}

declare global {
  interface Window {
    translate?: {
      version: string
      to: string
      language: {
        setLocal: (lang: string) => void
        getLocal: () => string
        getCurrent: () => string
      }
      selectLanguageTag: {
        show: boolean
      }
      service: {
        use: (name: string) => void
      }
      setAutoDiscriminateLocalLanguage: () => void
      listener: {
        start: () => void
        isStart: boolean
      }
      execute: () => void
      changeLanguage: (lang: string) => void
      request: {
        translateText: (
          text: string | string[] | { texts: string[]; from?: string; to?: string },
          callback: (data: { result: number; from: string; to: string; text: string[] }) => void,
        ) => void
      }
      nomenclature: {
        append: (from: string, to: string, properties: string) => void
      }
      storage: {
        set: (key: string, value: string) => void
        get: (key: string) => string | null
      }
    }
  }
}

export function loadTranslate(): Promise<void> {
  return new Promise((resolve) => {
    if (window.translate && typeof window.translate.version === 'string') {
      resolve()
      return
    }
    const s = document.createElement('script')
    s.src = TRANSLATE_CDN
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      console.warn('[translate] Failed to load translate.js')
      resolve()
    }
    document.head.appendChild(s)
  })
}

export function detectBrowserLang(): string | null {
  const raw = navigator.language?.split('-')[0] || ''
  if (!raw) return null
  if (raw === 'fr') return null
  return LANG_MAP[raw] || null
}

export function initTranslate(): void {
  const t = window.translate
  if (!t) return

  t.language.setLocal('french')
  t.selectLanguageTag.show = false
  t.service.use('client.edge')

  const target = detectBrowserLang()

  if (target && target !== 'french') {
    t.to = target
    t.storage.set('to', target)
    t.execute()
  }

  t.execute()

  t.listener.start()

  document.addEventListener('astro:after-swap', () => {
    t.execute()
  })
}

export async function bootstrapTranslate(): Promise<void> {
  await loadTranslate()
  initTranslate()
}

export function translateText(text: string): Promise<string> {
  const t = window.translate
  if (!t) return Promise.resolve(text)
  const to = t.to
  if (!to || to === 'french' || to === t.language.getLocal()) return Promise.resolve(text)
  return new Promise((resolve) => {
    t.request.translateText(text, (data) => {
      resolve(data.text?.[0] ?? text)
    })
  })
}

export function setLanguage(lang: string): void {
  const t = window.translate
  if (!t) return
  t.changeLanguage(lang)
}

export function getCurrentLang(): string {
  const t = window.translate
  if (!t) return 'french'
  return t.to || 'french'
}
