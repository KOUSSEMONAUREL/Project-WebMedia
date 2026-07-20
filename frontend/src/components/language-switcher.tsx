import { useEffect, useState } from 'react'
import { Languages } from 'lucide-react'
import { SUPPORTED_LANGS, getCurrentLang, setLanguage } from '@/lib/translate-init'

export function LanguageSwitcher() {
  const [targetLang, setTargetLang] = useState('french')

  useEffect(() => {
    setTargetLang(getCurrentLang())
  }, [])

  const handleSwitch = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const lang = e.target.value
    setTargetLang(lang)
    setLanguage(lang as (typeof SUPPORTED_LANGS)[number]['id'])
  }

  return (
    <div className="relative">
      <Languages className="absolute left-2.5 top-1/2 -translate-y-1/2 size-[1.1rem] text-muted-foreground pointer-events-none" />
      <select
        value={targetLang}
        onChange={handleSwitch}
        aria-label="Changer la langue"
        suppressHydrationWarning
        className="h-9 w-9 cursor-pointer rounded-full border-0 bg-transparent text-transparent hover:bg-white/[0.06] transition-colors appearance-none focus:outline-none focus:ring-1 focus:ring-primary/40"
        style={{ WebkitAppearance: 'none' }}
      >
        {SUPPORTED_LANGS.map(({ id, label }) => (
          <option key={id} value={id} className="text-foreground bg-background">
            {label}
          </option>
        ))}
      </select>
    </div>
  )
}
