'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CatalogView, type PublicCatalog } from '@/components/storefront/catalog-view';

export default function PublicCatalogPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<PublicCatalog | null>(null);
  const [notFound, setNotFound] = useState(false);
  useEffect(() => {
    fetch(`/api/public/catalog/${slug}`).then(async (r) => {
      if (!r.ok) return setNotFound(true);
      setData(await r.json());
      fetch(`/api/public/catalog/${slug}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'view' }) }).catch(() => undefined);
    }).catch(() => setNotFound(true));
  }, [slug]);
  const seen = new Set<string>();
  if (notFound) return <p className="p-10 text-center text-muted">Catálogo não encontrado.</p>;
  if (!data) return <p className="p-10 text-center text-muted" role="status">Carregando…</p>;
  return (
    <CatalogView
      data={data}
      onEvent={(kind, variantId) => {
        const k = `${kind}:${variantId ?? ''}`;
        if (seen.has(k)) return;
        seen.add(k);
        fetch(`/api/public/catalog/${slug}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, variantId }) }).catch(() => undefined);
      }}
      onOrder={async (o) => {
        const r = await fetch(`/api/public/catalog/${slug}/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error?.message ?? 'Falha ao enviar.');
        return j.number as string;
      }}
    />
  );
}
