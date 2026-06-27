import { cn } from '@/lib/utils';

interface ErrorStateProps {
  message?: string;
  className?: string;
}

export function ErrorState({ message = "Une erreur est survenue lors du chargement.", className }: ErrorStateProps) {
  return (
    <div className={cn("glass rounded-2xl p-12 text-center max-w-lg mx-auto", className)}>
      <div className="text-5xl mb-4 text-destructive">&#9888;</div>
      <h3 className="text-xl font-display font-semibold text-foreground mb-2">Erreur</h3>
      <p className="text-muted-foreground text-sm mb-6">{message}</p>
      <a
        href="/"
        className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-full font-semibold text-sm hover:brightness-110 transition-all"
      >
        Retour à l'accueil
      </a>
    </div>
  );
}
