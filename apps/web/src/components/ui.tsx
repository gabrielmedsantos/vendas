'use client';

import Link from 'next/link';
import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertTriangle, Inbox, Loader2, Lock, RefreshCw, X } from 'lucide-react';
import { formatBRL, parseBRL } from '@gct/shared';
import { ApiError } from '@/lib/client/api';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-primary-btn hover:bg-primary-btn-hover text-white shadow-[0_6px_24px_-8px_rgba(138,98,255,0.7)]',
  secondary: 'bg-surface-3 hover:bg-line-strong text-fg border border-line-strong',
  quiet: 'bg-transparent hover:bg-surface-3 text-muted hover:text-fg',
  danger: 'bg-danger/15 hover:bg-danger/25 text-danger-soft border border-danger/40',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; size?: 'sm' | 'md' }>(
  function Button({ variant = 'primary', loading, size = 'md', className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        {...rest}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cx(
          'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap',
          size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm',
          VARIANT[variant],
          className,
        )}
      >
        {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {children}
      </button>
    );
  },
);

export function LinkButton({ href, variant = 'primary', children, className }: { href: string; variant?: Variant; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cx('inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors whitespace-nowrap', VARIANT[variant], className)}>
      {children}
    </Link>
  );
}

export function Field({ label, error, help, children, htmlFor, required }: { label: string; error?: string; help?: string; children: ReactNode; htmlFor?: string; required?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
        {label}
        {required && <span aria-hidden className="text-danger-soft"> *</span>}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger-soft">
          {error}
        </p>
      ) : help ? (
        <p className="text-xs text-muted">{help}</p>
      ) : null}
    </div>
  );
}

const inputCls =
  'h-10 w-full rounded-xl border border-line bg-bg px-3 text-sm text-fg placeholder:text-muted/70 outline-none transition-colors focus:border-primary aria-[invalid=true]:border-danger';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...rest }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cx(inputCls, className)} {...rest} />;
});

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(inputCls, 'h-auto min-h-20 py-2', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(inputCls, 'appearance-none bg-[length:12px] pr-8', className)} {...rest}>
      {children}
    </select>
  );
}

/** Entrada monetária: digitação livre em reais; emite centavos como string de inteiro. */
export function MoneyInput({ value, onChange, id, invalid, placeholder = '0,00', disabled, ariaLabel }: { value: string; onChange: (cents: string) => void; id?: string; invalid?: boolean; placeholder?: string; disabled?: boolean; ariaLabel?: string }) {
  const [text, setText] = useState(() => (value ? formatBRL(value).replace(/^R\$\s?/, '') : ''));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value ? formatBRL(value).replace(/^R\$\s?/, '') : '');
    }
  }, [value]);
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">R$</span>
      <input
        id={id}
        aria-label={ariaLabel}
        inputMode="decimal"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className={cx(inputCls, 'pl-9 text-right tabular')}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.,]/g, '');
          setText(t);
          try {
            const c = t.trim() === '' ? '' : parseBRL(t).toString();
            last.current = c;
            onChange(c);
          } catch {
            /* valor parcial; mantém texto */
          }
        }}
        onBlur={() => setText(value ? formatBRL(value).replace(/^R\$\s?/, '') : '')}
      />
    </div>
  );
}

export function Card({ children, className, title, action, description }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; description?: ReactNode }) {
  return (
    <section className={cx('rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:p-5', className)}>
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone = 'default', icon, info }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'success' | 'danger' | 'warning' | 'primary'; icon?: ReactNode; info?: string }) {
  const toneCls = { default: 'text-fg', success: 'text-success', danger: 'text-danger-soft', warning: 'text-warning', primary: 'text-primary-soft' }[tone];
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{label}</span>
        <span className="flex items-center gap-1 text-muted">
          {info && (
            <span title={info} aria-label={info} className="cursor-help rounded-full border border-line px-1.5 text-[10px]">
              ?
            </span>
          )}
          {icon}
        </span>
      </div>
      <div className={cx('mt-2 text-xl font-semibold tabular sm:text-2xl', toneCls)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

const BADGE: Record<string, string> = {
  success: 'bg-success/10 text-success border-success/25',
  warning: 'bg-warning/10 text-warning border-warning/25',
  danger: 'bg-danger/10 text-danger-soft border-danger/30',
  info: 'bg-info/10 text-info border-info/25',
  primary: 'bg-primary/15 text-primary-soft border-primary/30',
  neutral: 'bg-surface-3 text-muted border-line',
};

export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof BADGE; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', BADGE[tone])}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-lg bg-surface-3', className)} aria-hidden />;
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Carregando">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10" />
      ))}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <div className="mb-1 grid size-12 place-items-center rounded-2xl bg-surface-3 text-primary-soft">{icon ?? <Inbox className="size-5" />}</div>
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  if (error instanceof ApiError && error.status === 403) return <NoPermission message={error.message} />;
  const msg = error instanceof Error ? error.message : 'Não foi possível carregar.';
  const rid = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-2xl border border-danger/30 bg-danger/5 px-4 py-8 text-center">
      <AlertTriangle className="size-5 text-danger-soft" />
      <p className="text-sm">{msg}</p>
      {rid && <p className="text-xs text-muted">Código: {rid}</p>}
      {retry && (
        <Button variant="secondary" size="sm" onClick={retry}>
          <RefreshCw className="size-3.5" /> Tentar de novo
        </Button>
      )}
    </div>
  );
}

export function NoPermission({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-10 text-center">
      <Lock className="size-5 text-warning" />
      <p className="font-medium">Sem permissão</p>
      <p className="max-w-md text-sm text-muted">{message ?? 'Seu papel nesta empresa não permite acessar este conteúdo. Peça ao proprietário para ajustar suas permissões.'}</p>
    </div>
  );
}

const FIELD_LABEL: Record<string, string> = {
  name: 'Nome', description: 'Descrição', amountCents: 'Valor', accountId: 'Conta', kind: 'Tipo', direction: 'Sentido', occurredOn: 'Data', date: 'Data',
  email: 'E-mail', phone: 'Telefone', document: 'CPF/CNPJ', reason: 'Motivo', quantity: 'Quantidade', unitCostCents: 'Custo', retailPriceCents: 'Preço',
  sku: 'SKU', categoryId: 'Categoria', supplierId: 'Fornecedor', customerId: 'Cliente', dueDate: 'Vencimento', competenceDate: 'Data', items: 'Itens',
  variants: 'Variações', payments: 'Pagamentos', targetCents: 'Valor', title: 'Título', text: 'Texto', fromAccountId: 'Conta de origem', toAccountId: 'Conta de destino',
};
/** "variants.0.sku" → "SKU (variação 1)"; campos desconhecidos aparecem como vieram. */
function fieldLabel(key: string): string {
  const parts = key.split('.');
  const last = [...parts].reverse().find((p) => !/^\d+$/.test(p)) ?? key;
  const idx = parts.find((p) => /^\d+$/.test(p));
  const label = FIELD_LABEL[last] ?? (last === '_' ? 'Geral' : last);
  return idx !== undefined ? `${label} (item ${Number(idx) + 1})` : label;
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  return (
    <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger-soft">
      {e.message ?? 'Erro'}
      {e.fields && Object.keys(e.fields).length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs">
          {Object.entries(e.fields).map(([k, v]) => (
            <li key={k}>
              {fieldLabel(k)}: {v}
            </li>
          ))}
        </ul>
      )}
      {e.requestId && <p className="mt-1 text-[11px] opacity-70">Código: {e.requestId}</p>}
    </div>
  );
}

/** Modal acessível com <dialog> nativo (foco preso, Esc fecha). Vira tela cheia no celular. */
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={cx(
        'm-0 h-full max-h-none w-full max-w-none bg-surface text-fg sm:m-auto sm:h-auto sm:max-h-[90vh] sm:rounded-2xl sm:border sm:border-line',
        wide ? 'sm:max-w-4xl' : 'sm:max-w-lg',
      )}
    >
      {open && (
        <div className="flex h-full flex-col">
          <header className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-surface-3 hover:text-fg" aria-label="Fechar">
              <X className="size-4" />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}
export const Th = ({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) => (
  <th scope="col" className={cx('border-b border-line px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted', right && 'text-right', className)}>
    {children}
  </th>
);
export const Td = ({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) => (
  <td className={cx('border-b border-line/60 px-3 py-2.5 align-middle', right && 'text-right tabular', className)}>{children}</td>
);

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[] }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-bg p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors', value === o.value ? 'bg-surface-3 text-fg' : 'text-muted hover:text-fg')}
        >
          {o.label}
          {o.count !== undefined && <span className="ml-1.5 text-muted">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pager({ hasMore, cursor, onNext, onFirst, isFirst, total }: { hasMore?: boolean; cursor?: string | null; onNext: (c: string) => void; onFirst: () => void; isFirst: boolean; total?: number }) {
  if (!hasMore && isFirst) return total !== undefined ? <p className="mt-3 text-xs text-muted">{total} registro(s)</p> : null;
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-muted">
      <span>{total !== undefined ? `${total} registro(s)` : ''}</span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={isFirst} onClick={onFirst}>
          Início
        </Button>
        <Button variant="secondary" size="sm" disabled={!hasMore || !cursor} onClick={() => cursor && onNext(cursor)}>
          Próxima
        </Button>
      </div>
    </div>
  );
}

export function Money({ cents, tone }: { cents: string | null | undefined; tone?: 'auto' }) {
  if (cents === null || cents === undefined) return <span className="text-muted">—</span>;
  const neg = cents.startsWith('-');
  return <span className={cx('tabular', tone === 'auto' && (neg ? 'text-danger-soft' : 'text-success'))}>{formatBRL(cents)}</span>;
}
