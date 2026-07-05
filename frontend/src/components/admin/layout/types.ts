export type SidebarData = {
  user: {
    name: string
    email: string
    avatar: string
  }
  teams: Array<{
    name: string
    logo: React.ElementType
    plan: string
  }>
  navGroups: NavGroup[]
}

export type NavGroup = {
  title: string
  items: NavItem[]
}

type BaseNavItem = {
  title: string
  badge?: string
  icon?: React.ElementType
}

type NavLink = BaseNavItem & {
  url: string
  items?: never
}

type NavCollapsible = BaseNavItem & {
  items: (BaseNavItem & { url: string })[]
  url?: never
}

type NavItem = NavCollapsible | NavLink

export type { SidebarData, NavGroup, NavItem, NavCollapsible, NavLink }
