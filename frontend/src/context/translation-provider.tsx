import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { bootstrapTranslate, getCurrentLang, setLanguage, translateText } from '@/lib/translate-init'

const SUPPORTED_LANGS = [
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

interface TranslationContextValue {
  ready: boolean
  targetLang: string
  supportedLangs: typeof SUPPORTED_LANGS
  setLang: (lang: string) => void
  t: (text: string) => Promise<string>
}

const defaultContext: TranslationContextValue = {
  ready: false,
  targetLang: 'french',
  supportedLangs: SUPPORTED_LANGS,
  setLang: () => {},
  t: async (text: string) => text,
}

const TranslationContext = createContext<TranslationContextValue>(defaultContext)

export function TranslationProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [targetLang, setTargetLang] = useState('french')

  useEffect(() => {
    let cancelled = false
    bootstrapTranslate().then(() => {
      if (cancelled) return
      setReady(true)
      setTargetLang(getCurrentLang())
    })
    return () => { cancelled = true }
  }, [])

  const setLang = useCallback((lang: string) => {
    setLanguage(lang)
    setTargetLang(lang)
  }, [])

  const t = useCallback(async (text: string): Promise<string> => {
    if (!ready) return text
    return translateText(text)
  }, [ready])

  return (
    <TranslationContext.Provider value={{ ready, targetLang, supportedLangs: SUPPORTED_LANGS, setLang, t }}>
      {children}
    </TranslationContext.Provider>
  )
}

export function useTranslation(): TranslationContextValue {
  return useContext(TranslationContext)
}
