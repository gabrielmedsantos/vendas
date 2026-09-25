export function AuthCard({ eyebrow, title, subtitle, children, footer }: { eyebrow: string; title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="w-full max-w-md rounded-2xl border border-line bg-surface/90 p-6 shadow-2xl backdrop-blur sm:p-8">
      <p className="text-xs font-medium uppercase tracking-widest text-primary-soft">{eyebrow}</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      <div className="mt-6">{children}</div>
      {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
    </div>
  );
}
