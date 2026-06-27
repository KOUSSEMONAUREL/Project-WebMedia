import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description: string;
  action?: { label: string; href: string };
  className?: string;
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("glass rounded-2xl p-12 text-center max-w-lg mx-auto", className)}>
      <h3 className="text-xl font-display font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm mb-6">{description}</p>
      {action && (
        <a
          href={action.href}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-full font-semibold text-sm hover:brightness-110 transition-all"
        >
          {action.label}
        </a>
      )}
    </div>
  );
}
