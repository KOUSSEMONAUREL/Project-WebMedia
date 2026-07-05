const TRANSLATE_CDN = 'https://res.zvo.cn/translate/translate.js'

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
      selectLanguageTag: { show: boolean }
      service: { use: (name: string) => void }
      execute: () => void
      changeLanguage: (lang: string) => void
      request: {
        translateText: (
          text: string | string[] | { texts: string[]; from?: string; to?: string },
          callback: (data: { result: number; from: string; to: string; text: string[] }) => void,
        ) => void
      }
      ignore: {
        tagname: string[]
        class: string[]
        id: string[]
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
      console.warn('[translate] CDN failed')
      resolve()
    }
    document.head.appendChild(s)
  })
}

export function initTranslate(): void {
  const t = window.translate
  if (!t) return

  t.language.setLocal('french')
  t.selectLanguageTag.show = false

  t.ignore.tagname = t.ignore.tagname || []
  t.ignore.tagname.push('ASTRO-ISLAND', 'SCRIPT', 'STYLE')

  t.service.use('client.edge')
}

export async function bootstrapTranslate(): Promise<void> {
  await loadTranslate()
  initTranslate()
}

export function translateText(text: string): Promise<string> {
  const t = window.translate
  if (!t) return Promise.resolve(text)
  const to = t.to
  if (!to || to === 'french') return Promise.resolve(text)
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
  t.execute()
}

export function getCurrentLang(): string {
  const t = window.translate
  if (!t) return 'french'
  return t.to || 'french'
}
