'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listingDefaults, type ListingDefaults } from '@gct/shared';
import { useRouter } from 'next/navigation';
import { ProductForm, emptyProduct, toApi } from '@/components/products/product-form';
import { LoadingBlock, NoPermission, PageHeader } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/client/api';
import { useCan } from '@/lib/client/session';

export default function NewProductPage() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const can = useCan();
  // Garantia inicial = padrão de anúncio da empresa (3 meses se nada foi salvo).
  const t = useQuery({ queryKey: ['tenant'], queryFn: () => api<{ address: Record<string, string>; settings: { listing?: ListingDefaults | null } }>('tenant') });
  if (!can('products.manage')) return <NoPermission />;
  if (t.isLoading) return <LoadingBlock />;
  const months = listingDefaults(t.data?.settings.listing).warrantyMonths;
  return (
    <div>
      <PageHeader title="Novo produto" description="Cadastro do item. Estoque e custo entram por compra, troca ou ajuste." />
      <ProductForm
        initial={{ ...emptyProduct(), warrantyDays: String(months * 30) }}
        submitLabel="Cadastrar"
        onSubmit={async (v) => {
          const r = await api<{ id: string }>('products', { body: toApi(v) });
          await qc.invalidateQueries({ queryKey: ['products'] });
          toast('Produto cadastrado.');
          router.push(`/app/produtos/${r.id}`);
        }}
      />
    </div>
  );
}
