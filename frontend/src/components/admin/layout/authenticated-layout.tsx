import { cn } from '@/lib/utils'
import { LayoutProvider } from '@/context/layout-provider'
import { SearchProvider } from '@/context/search-provider'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from './app-sidebar'
import type { Tab } from '../AdminApp'

type Props = {
  children?: React.ReactNode
  currentTab: Tab
  onTabChange: (tab: Tab) => void
}

export function AuthenticatedLayout({ children, currentTab, onTabChange }: Props) {
  return (
    <SearchProvider>
      <LayoutProvider>
        <SidebarProvider defaultOpen={true}>
          <AppSidebar currentTab={currentTab} onTabChange={onTabChange} />
          <SidebarInset
            className={cn(
              '@container/content',
              'has-data-[layout=fixed]:h-svh',
            )}
          >
            {children}
          </SidebarInset>
        </SidebarProvider>
      </LayoutProvider>
    </SearchProvider>
  )
}
