import { Search, Wifi, Radio, Loader2 } from 'lucide-react';

function flagEmoji(code: string): string {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(
    ...code.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
  );
}

interface Props {
  search: string;
  onSearchChange: (v: string) => void;
  country: string;
  onCountryChange: (v: string) => void;
  category: string;
  onCategoryChange: (v: string) => void;
  sortBy: string;
  onSortChange: (v: string) => void;
  aliveOnly: boolean;
  onAliveToggle: () => void;
  countries: string[];
  categories: string[];
  verifyingCount: number;
}

export function ChannelFilters({
  search, onSearchChange,
  country, onCountryChange,
  category, onCategoryChange,
  sortBy, onSortChange,
  aliveOnly, onAliveToggle,
  countries, categories,
  verifyingCount,
}: Props) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4 mb-6 space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text" placeholder="Rechercher une chaine..."
          value={search} onChange={e => onSearchChange(e.target.value)}
          className="w-full pl-10 pr-4 py-3 bg-muted/50 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Pays"
          value={country} onChange={e => onCountryChange(e.target.value)}
          className="flex-1 min-w-[140px] px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
        >
          <option value="">Tous les pays</option>
          {countries.map(c => (
            <option key={c} value={c}>{flagEmoji(c)} {c}</option>
          ))}
        </select>
        <select
          aria-label="Categorie"
          value={category} onChange={e => onCategoryChange(e.target.value)}
          className="flex-1 min-w-[140px] px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
        >
          <option value="">Toutes les categories</option>
          {categories.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <select
          aria-label="Trier par"
          value={sortBy} onChange={e => onSortChange(e.target.value)}
          className="min-w-[120px] px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
        >
          <option value="name">Nom A-Z</option>
          <option value="name-desc">Nom Z-A</option>
          <option value="streams">Plus de sources</option>
        </select>
        <button
          type="button"
          onClick={onAliveToggle}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm transition-all ${
            aliveOnly
              ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400'
              : 'bg-muted/50 border-border hover:border-primary/50'
          }`}
          title="Afficher uniquement les chaines dont les flux sont actifs"
        >
          {aliveOnly ? <Wifi className="w-4 h-4" /> : <Radio className="w-4 h-4" />}
          <span className="hidden sm:inline">{aliveOnly ? 'Actifs' : 'Verifier'}</span>
          {verifyingCount > 0 && (
            <Loader2 className="w-3 h-3 animate-spin" />
          )}
        </button>
      </div>
    </div>
  );
}
