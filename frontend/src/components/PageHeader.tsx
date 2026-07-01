interface PageHeaderProps {
  title: string;
  subtitle?: string;
}

export function PageHeader({ title, subtitle }: PageHeaderProps) {
  return (
    <div className="pb-6 mb-2 border-b border-border/30">
      <div className="flex items-center gap-3">
        <span
          className="h-6 w-[3px] rounded-full shrink-0"
          style={{ background: 'linear-gradient(180deg, #60a5fa 0%, #3b82f6 100%)' }}
        />
        <h1
          className="text-2xl md:text-3xl font-display font-bold"
          style={{
            background: 'linear-gradient(135deg, #93c5fd 0%, #60a5fa 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          {title}
        </h1>
      </div>
      {subtitle && (
        <p className="mt-2 text-sm text-muted-foreground ml-[15px]">{subtitle}</p>
      )}
    </div>
  );
}
