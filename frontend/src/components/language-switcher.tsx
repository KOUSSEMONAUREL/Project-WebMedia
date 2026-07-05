import { useTranslation } from '@/context/translation-provider'
import { Check, Languages } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function LanguageSwitcher() {
  const { targetLang, supportedLangs, setLang } = useTranslation()

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='icon' className='scale-95 rounded-full text-muted-foreground hover:text-foreground'>
          <Languages className='size-[1.2rem]' />
          <span className='sr-only'>Changer la langue</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='max-h-64 overflow-y-auto'>
        {supportedLangs.map(({ id, label }) => (
          <DropdownMenuItem key={id} onClick={() => setLang(id)}>
            {label}
            <Check
              size={14}
              className={cn('ms-auto', targetLang !== id && 'hidden')}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
