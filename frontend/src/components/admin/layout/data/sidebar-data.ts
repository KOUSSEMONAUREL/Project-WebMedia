import { LayoutDashboard, Film, Clapperboard, Link2, Briefcase, ShieldCheck, Settings, HelpCircle, Bug, Lock, FileX, ServerOff, Construction, UserX, Command, GalleryVerticalEnd, AudioWaveform } from 'lucide-react'
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
    {
      title: 'Pages',
      items: [
        {
          title: 'Auth',
          icon: ShieldCheck,
          items: [
            { title: 'Sign In', url: '/admin/auth/sign-in' },
            { title: 'Sign Up', url: '/admin/auth/sign-up' },
            { title: 'Forgot Password', url: '/admin/auth/forgot-password' },
          ],
        },
        {
          title: 'Errors',
          icon: Bug,
          items: [
            { title: 'Unauthorized', url: '/errors/unauthorized', icon: Lock },
            { title: 'Forbidden', url: '/errors/forbidden', icon: UserX },
            { title: 'Not Found', url: '/errors/not-found', icon: FileX },
            { title: 'Internal Error', url: '/errors/internal-server-error', icon: ServerOff },
            { title: 'Maintenance', url: '/errors/maintenance-error', icon: Construction },
          ],
        },
      ],
    },
    {
      title: 'Autres',
      items: [
        { title: 'Settings', url: '/settings', icon: Settings },
        { title: 'Help Center', url: '/help-center', icon: HelpCircle },
      ],
    },
  ],
}
