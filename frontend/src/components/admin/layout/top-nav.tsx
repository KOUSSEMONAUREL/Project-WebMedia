import { cn } from '@/lib/utils'

export type TopNavItem = {
  title: string
  href: string
  isActive: boolean
  disabled?: boolean
}

interface TopNavProps extends React.ComponentProps<'nav'> {
  links: TopNavItem[]
}

export function TopNav({ className, links, ...props }: TopNavProps) {
  return (
    <nav
      className={cn(
        'hidden items-center gap-1 md:flex',
        className
      )}
      {...props}
    >
      {links.map((link) => (
        <a
          key={link.title}
          href={link.href}
          className={cn(
            'px-3 py-1.5 text-sm font-medium transition-colors rounded-md',
            link.isActive
              ? 'text-foreground bg-accent'
              : 'text-muted-foreground hover:text-foreground',
            link.disabled && 'pointer-events-none opacity-50'
          )}
          aria-disabled={link.disabled}
        >
          {link.title}
        </a>
      ))}
    </nav>
  )
}
