import { useEffect, useState } from 'react'
import { Languages } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getCurrentLang, setLanguage } from '@/lib/translate-init'

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

export function LanguageSwitcher() {
  const [targetLang, setTargetLang] = useState('french')

  useEffect(() => {
    setTargetLang(getCurrentLang())
    const interval = setInterval(() => {
      const current = getCurrentLang()
      if (current !== targetLang) setTargetLang(current)
    }, 500)
    return () => clearInterval(interval)
  }, [])

  const handleSwitch = (lang: string) => {
    setLanguage(lang)
    setTargetLang(lang)
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='icon' className='scale-95 rounded-full text-muted-foreground hover:text-foreground'>
          <Languages className='size-[1.2rem]' />
          <span className='sr-only'>Changer la langue</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='max-h-64 overflow-y-auto'>
        {SUPPORTED_LANGS.map(({ id, label }) => (
          <DropdownMenuItem key={id} onClick={() => handleSwitch(id)}>
            {label}
            <span
              className={cn('ms-auto text-primary', targetLang !== id && 'hidden')}
            >
              ✓
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
