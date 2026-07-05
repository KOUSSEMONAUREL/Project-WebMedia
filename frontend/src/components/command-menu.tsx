import { ArrowRight, ChevronRight, Laptop, Moon, Sun } from 'lucide-react'
import { useSearch } from '@/context/search-provider'
import { useTheme } from '@/context/theme-provider'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { sidebarData } from '@/components/admin/layout/data/sidebar-data'

export function CommandMenu() {
  const { open, setOpen } = useSearch()
  const { setTheme } = useTheme()

  const runCommand = (command: () => void) => {
    setOpen(false)
    command()
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {sidebarData.navGroups.map((group) => (
          <CommandGroup key={group.title} heading={group.title}>
            {group.items.map((navItem: any) => {
              if (navItem.items) {
                return navItem.items.map((subItem: any) => (
                  <CommandItem
                    key={subItem.title}
                    onSelect={() => {
                      runCommand(() => {
                        window.location.href = subItem.url
                      })
                    }}
                  >
                    <ArrowRight className="mr-2 h-4 w-4" />
                    <span>{subItem.title}</span>
                    {subItem.badge && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {subItem.badge}
                      </span>
                    )}
                  </CommandItem>
                ))
              }
              return (
                <CommandItem
                  key={navItem.title}
                  onSelect={() => {
                    runCommand(() => {
                      if (navItem.url) window.location.href = navItem.url
                    })
                  }}
                >
                  {navItem.icon && <navItem.icon className="mr-2 h-4 w-4" />}
                  <span>{navItem.title}</span>
                  {navItem.badge && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {navItem.badge}
                    </span>
                  )}
                </CommandItem>
              )
            })}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup heading="Theme">
          <CommandItem onSelect={() => runCommand(() => setTheme('light'))}>
            <Sun className="mr-2 h-4 w-4" />
            Light
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => setTheme('dark'))}>
            <Moon className="mr-2 h-4 w-4" />
            Dark
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => setTheme('system'))}>
            <Laptop className="mr-2 h-4 w-4" />
            System
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
