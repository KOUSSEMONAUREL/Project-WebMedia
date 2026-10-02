import { useT } from '@/lib/translate-init';
import { T } from './T';

const LIENS = [
  { href: '/', label: 'Accueil' },
  { href: '/about', label: 'À propos' },
  { href: '/legal', label: 'Mentions légales' },
  { href: '/contact', label: 'Contact' },
];

const CATEGORIES = [
  { href: '/type/film', label: 'Films' },
  { href: '/type/serie', label: 'Séries' },
  { href: '/type/anime', label: 'Animes' },
  { href: '/type/jeu', label: 'Jeux' },
  { href: '/type/book', label: 'Livres & Light Novels' },
];

export function Footer() {
  const aboutTitle = useT('Qui sommes-nous');
  const aboutText1 = useT(
    'WebMediia est un annuaire de streaming gratuit référençant des films, séries, animes, mangas, webtoons, jeux, livres et light novels.',
  );
  const aboutText2 = useT(
    "WebMediia n'héberge pas les contenus. Pour toute réclamation, veuillez contacter la plateforme d'hébergement concernée.",
  );
  const linksTitle = useT('Liens utiles');
  const catTitle = useT('Catégories');
  const rights = useT('© 2026 Tous droits réservés');

  return (
    <footer className="border-t border-border/30 mt-16">
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="md:col-span-2">
            <h4 className="text-sm font-semibold mb-3 text-foreground">{aboutTitle}</h4>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-md">{aboutText1}</p>
            <p className="text-[11px] text-muted-foreground/50 mt-3 leading-relaxed max-w-md">{aboutText2}</p>
          </div>
          <div>
            <h4 className="text-sm font-semibold mb-3 text-foreground">{linksTitle}</h4>
            <ul className="space-y-2">
              {LIENS.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                    {<T>{l.label}</T>}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold mb-3 text-foreground">{catTitle}</h4>
            <ul className="space-y-2">
              {CATEGORIES.map((c) => (
                <li key={c.href}>
                  <a href={c.href} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                    {<T>{c.label}</T>}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <div className="border-t border-border/20 px-4 py-5">
        <div className="max-w-7xl mx-auto flex items-center justify-center gap-2">
          <span className="text-sm font-semibold text-foreground">WebMediia</span>
          <span className="text-xs text-muted-foreground">{rights}</span>
        </div>
      </div>
    </footer>
  );
}
