import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarRail } from '@/components/ui/sidebar'
import { mainNav } from '../sidebar-data'
import type { Tab } from '../AdminApp'

type Props = {
  currentTab: Tab
  onTabChange: (tab: Tab) => void
}

export function AppSidebar({ currentTab, onTabChange }: Props) {
  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Gestion</SidebarGroupLabel>
          <SidebarMenu>
            {mainNav.map((item) => (
              <SidebarMenuItem key={item.tab}>
                <SidebarMenuButton
                  isActive={currentTab === item.tab}
                  onClick={() => onTabChange(item.tab)}
                  tooltip={item.title}
                >
                  <item.icon />
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
