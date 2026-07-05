import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar'
import type { NavGroup, NavItem, NavLink } from './types'

export function NavGroup({ title, items }: NavGroup) {
  const { setOpenMobile } = useSidebar()

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{title}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          const key = `${title}-${item.title}`
          if (item.items)
            return (
              <SidebarCollapsibleItem key={key} item={item} setOpenMobile={setOpenMobile} />
            )
          return <SidebarMenuItemLink key={key} item={item} setOpenMobile={setOpenMobile} />
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}

function SidebarMenuItemLink({
  item,
  setOpenMobile,
}: {
  item: NavLink
  setOpenMobile: (open: boolean) => void
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={window.location.pathname === item.url}
        tooltip={item.title}
      >
        <a href={item.url} onClick={() => setOpenMobile(false)}>
          {item.icon && <item.icon />}
          <span>{item.title}</span>
          {item.badge && <Badge variant="outline">{item.badge}</Badge>}
        </a>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function SidebarCollapsibleItem({
  item,
  setOpenMobile,
}: {
  item: NavItem
  setOpenMobile: (open: boolean) => void
}) {
  const [open, setOpen] = useState(() =>
    item.items?.some((sub) => window.location.pathname === sub.url)
  )

  if (!item.items) return null

  return (
    <Collapsible defaultOpen={open} asChild className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={item.title}>
            {item.icon && <item.icon />}
            <span>{item.title}</span>
            <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.items.map((subItem) => (
              <SidebarMenuSubItem key={subItem.title}>
                <SidebarMenuSubButton
                  asChild
                  isActive={window.location.pathname === subItem.url}
                >
                  <a href={subItem.url} onClick={() => setOpenMobile(false)}>
                    {subItem.icon && <subItem.icon />}
                    <span>{subItem.title}</span>
                    {subItem.badge && (
                      <Badge variant="outline" className="ml-auto">
                        {subItem.badge}
                      </Badge>
                    )}
                  </a>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}
