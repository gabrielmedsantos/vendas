'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, X } from 'lucide-react';

interface Toast {
  id: number;
  message: string;
  tone: 'success' | 'info';
}

const Ctx = createContext<(message: string, tone?: Toast['tone']) => void>(() => undefined);

/** Toast só confirma sucesso; erros ficam persistentes na própria tela. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, message, tone }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 5000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto flex max-w-sm items-start gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm shadow-xl">
            {t.tone === 'success' ? <CheckCircle2 className="mt-0.5 size-4 text-success" /> : <Info className="mt-0.5 size-4 text-info" />}
            <span className="flex-1">{t.message}</span>
            <button aria-label="Fechar aviso" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))} className="text-muted hover:text-fg">
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
