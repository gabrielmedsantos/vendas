'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ProductForm, emptyProduct, toApi } from '@/components/products/product-form';
import { NoPermission, PageHeader } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/client/api';
import { useCan } from '@/lib/client/session';

export default function NewProductPage() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const can = useCan();
  if (!can('products.manage')) return <NoPermission />;
  return (
    <div>
      <PageHeader title="Novo produto" description="Cadastro do item. Estoque e custo entram por compra, troca ou ajuste." />
      <ProductForm
        initial={emptyProduct()}
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
