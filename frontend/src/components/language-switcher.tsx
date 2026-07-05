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
import { SUPPORTED_LANGS, getCurrentLang, setLanguage } from '@/lib/translate-init'

export function LanguageSwitcher() {
  const [targetLang, setTargetLang] = useState('french')

  useEffect(() => {
    setTargetLang(getCurrentLang())
  }, [])

  const handleSwitch = (lang: string) => {
    setTargetLang(lang)
    setLanguage(lang as (typeof SUPPORTED_LANGS)[number]['id'])
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
            <span className={cn('ms-auto text-primary', targetLang !== id && 'hidden')}>
              ✓
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
