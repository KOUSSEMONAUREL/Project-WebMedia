import { LayoutDashboard, Film, Clapperboard, Link2, Briefcase, Command } from 'lucide-react'
import type { SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'Admin',
    email: 'admin@webmedia.app',
    avatar: '/avatars/shadcn.jpg',
  },
  teams: [
    {
      name: 'WebMedia',
      logo: Command,
      plan: 'Admin Panel',
    },
  ],
  navGroups: [
    {
      title: 'Gestion',
      items: [
        { title: 'Dashboard', url: '/admin', icon: LayoutDashboard },
        { title: 'Medias', url: '/admin/medias', icon: Film },
        { title: 'Episodes', url: '/admin/episodes', icon: Clapperboard },
        { title: 'Liens', url: '/admin/liens', icon: Link2 },
        { title: 'Jobs', url: '/admin/jobs', icon: Briefcase },
      ],
    },
  ],
}
