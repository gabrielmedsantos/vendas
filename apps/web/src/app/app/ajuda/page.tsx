'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { LifeBuoy, Search } from 'lucide-react';
import { useDebounced } from '@/components/ops/hooks';
import { Card, EmptyState, ErrorState, Input, LoadingBlock, PageHeader, Tabs } from '@/components/ui';
import { api, qs } from '@/lib/client/api';

interface Article { slug: string; category: string; title: string; summary: string; readingMinutes: number }
const CATEGORIES: Record<string, string> = { 'primeiros-passos': 'Primeiros passos', vendas: 'Vendas', trocas: 'Trocas', estoque: 'Estoque', financeiro: 'Financeiro', seguranca: 'Segurança' };

export default function HelpPage() {
  const [category, setCategory] = useState('');
  const [term, setTerm] = useState('');
  const q = useDebounced(term, 250);
  const list = useQuery({ queryKey: ['help', category, q], queryFn: () => api<Article[]>(`help${qs({ category: category || undefined, q })}`) });
  return (
    <div>
      <PageHeader title="Central de ajuda" description="Guias curtos sobre como o sistema registra vendas, trocas, estoque e financeiro." />
      <Card>
        <div className="flex flex-col gap-3">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Buscar: troca, parcela, estorno…" className="pl-9" aria-label="Buscar na ajuda" /></div>
          <Tabs value={category} onChange={setCategory} options={[{ value: '', label: 'Todos' }, ...Object.entries(CATEGORIES).map(([value, label]) => ({ value, label }))]} />
        </div>
        <div className="mt-4">
          {list.isLoading && <LoadingBlock />}
          {list.error && <ErrorState error={list.error} retry={() => list.refetch()} />}
          {list.data && list.data.length === 0 && <EmptyState icon={<LifeBuoy className="size-5" />} title="Nenhum artigo encontrado" description="Tente outra palavra ou veja todas as categorias." />}
          {list.data && list.data.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2">
              {list.data.map((a) => (
                <li key={a.slug}>
                  <Link href={`/app/ajuda/${a.slug}`} className="block h-full rounded-xl border border-line bg-bg p-4 hover:border-primary">
                    <span className="text-[11px] uppercase tracking-wide text-muted">{CATEGORIES[a.category] ?? a.category} · {a.readingMinutes} min</span>
                    <span className="mt-1 block font-medium">{a.title}</span>
                    <span className="mt-1 block text-sm text-muted">{a.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
