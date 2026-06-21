import React from 'react';
import { 
  Home, 
  Film, 
  Tv, 
  Gamepad2, 
  Library, 
  BookOpen,
  NotebookPen,
  Compass, 
  Heart, 
  Clock, 
  Settings,
  HelpCircle,
  Hash
} from 'lucide-react';
import { cn } from '@/lib/utils';

const sidebarItems = [
  { group: "Menu", items: [
    { icon: Home, label: "Accueil", href: "/" },
    { icon: Compass, label: "Découvrir", href: "/discover" },
    { icon: Hash, label: "Genres", href: "/genres" },
  ]},
  { group: "Bibliothèque", items: [
    { icon: Film, label: "Films", href: "/films" },
    { icon: Tv, label: "Séries", href: "/series" },
    { icon: Library, label: "Animés", href: "/animes" },
    { icon: Gamepad2, label: "Jeux Vidéo", href: "/games" },
    { icon: BookOpen, label: "Webtoons", href: "/webtoons" },
    { icon: BookOpen, label: "Livres", href: "/books" },
    { icon: NotebookPen, label: "Light Novels", href: "/novels" },
  ]},
  { group: "Personnel", items: [
    { icon: Heart, label: "Favoris", href: "/favorites" },
    { icon: Clock, label: "À voir plus tard", href: "/watchlist" },
  ]},
  { group: "Autre", items: [
    { icon: Settings, label: "Paramètres", href: "/settings" },
    { icon: HelpCircle, label: "Aide", href: "/help" },
  ]}
];

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  return (
    <aside className={cn(
      "w-64 bg-card border-r border-border h-screen sticky top-0 overflow-y-auto hidden lg:flex flex-col py-8 px-4 gap-8 items-center",
      className
    )}>
      <div className="flex items-center justify-center mb-4 w-full">
        <span className="text-3xl font-display font-semibold text-primary italic">
          WebMedia
        </span>
      </div>

      <nav className="flex flex-col gap-6 w-full">
        {sidebarItems.map((group, i) => (
          <div key={i} className="flex flex-col gap-2">
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-center">
              {group.group}
            </h3>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item, j) => (
                <a
                  key={j}
                  href={item.href}
                  className="flex items-center justify-center gap-3 px-3 py-2.5 text-sm font-medium transition-all rounded-lg hover:bg-secondary hover:text-primary text-muted-foreground"
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
