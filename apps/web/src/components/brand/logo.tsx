/** Marca provisória própria (não reproduz logos das referências). */
export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight">
      <span aria-hidden className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-primary to-primary-soft text-sm font-bold text-white shadow-[0_0_24px_-6px_rgba(138,98,255,0.8)]">
        ⇄
      </span>
      {!compact && (
        <span className="leading-tight">
          <span className="block text-sm">Gestão</span>
          <span className="block text-[11px] font-medium text-muted">Compra e Troca</span>
        </span>
      )}
    </span>
  );
}
