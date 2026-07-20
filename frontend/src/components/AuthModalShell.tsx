import { X } from 'lucide-react';
import { Button } from './ui/button';

interface AuthModalShellProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function AuthModalShell({ title, onClose, children }: AuthModalShellProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <button
        type="button"
        aria-label="Fermer"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-pointer"
        onClick={onClose}
      />

      <div className="relative w-full max-w-md mx-4 bg-card border border-border/70 rounded-2xl shadow-2xl overflow-hidden" style={{boxShadow:'0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)'}}>
        <div
          className="relative h-20 flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, rgba(59,130,246,0.15) 0%, rgba(59,130,246,0.06) 100%)',
            borderBottom: '1px solid rgba(59,130,246,0.15)',
          }}
        >
          <h2 className="text-xl font-display font-bold tracking-tight" style={{
            background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>
            {title}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-3 right-3 text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
