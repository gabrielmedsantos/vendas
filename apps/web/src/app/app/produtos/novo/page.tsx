'use client';

import { useQuery } from '@tanstack/react-query';
import { listingDefaults, type ListingDefaults } from '@gct/shared';
import { useRouter } from 'next/navigation';
import { NewProductWizard } from '@/components/products/new-product-wizard';
import { LoadingBlock, NoPermission, PageHeader } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/client/api';
import { useCan } from '@/lib/client/session';

export default function NewProductPage() {
  const router = useRouter();
  const toast = useToast();
  const can = useCan();
  // Garantia inicial = padrão de anúncio da empresa (3 meses se nada foi salvo).
  const t = useQuery({ queryKey: ['tenant'], queryFn: () => api<{ address: Record<string, string>; settings: { listing?: ListingDefaults | null } }>('tenant') });
  if (!can('products.manage')) return <NoPermission />;
  if (t.isLoading) return <LoadingBlock />;
  const months = listingDefaults(t.data?.settings.listing).warrantyMonths;
  return (
    <div>
      <PageHeader title="Novo produto" description="Tudo em um lugar: dados, preço, estoque e de onde veio a mercadoria." />
      <NewProductWizard warrantyMonths={months} onCreated={(id) => { toast('Produto cadastrado.'); router.push(`/app/produtos/${id}`); }} />
    </div>
  );
}
