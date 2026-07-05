import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { useSearch } from '@/context/search-provider'
import { ArrowRight } from 'lucide-react'
import { mainNav } from '@/components/admin/sidebar-data'

export function CommandMenu() {
  const { open, setOpen } = useSearch()

  const run = (url: string) => {
    setOpen(false)
    window.location.href = url
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Tapez une commande..." />
      <CommandList>
        <CommandEmpty>Aucun resultat.</CommandEmpty>
        <CommandGroup heading="Navigation">
          {mainNav.map((item) => (
            <CommandItem key={item.tab} onSelect={() => run('/admin')}>
              <item.icon className="mr-2 h-4 w-4" />
              <span>{item.title}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
