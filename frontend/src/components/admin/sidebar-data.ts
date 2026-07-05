import { LayoutDashboard, Film, Clapperboard, Link2, Briefcase, type LucideIcon } from 'lucide-react'

export type Tab = 'dashboard' | 'medias' | 'episodes' | 'liens' | 'jobs'

export interface NavItem {
  title: string
  tab: Tab
  icon: LucideIcon
}

export const mainNav: NavItem[] = [
  { title: 'Dashboard', tab: 'dashboard', icon: LayoutDashboard },
  { title: 'Medias', tab: 'medias', icon: Film },
  { title: 'Episodes', tab: 'episodes', icon: Clapperboard },
  { title: 'Liens', tab: 'liens', icon: Link2 },
  { title: 'Jobs', tab: 'jobs', icon: Briefcase },
]
