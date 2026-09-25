'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { useCategories } from '@/components/ops/hooks';
import { Button, EmptyState, ErrorState, Field, FormError, Input, LoadingBlock, Modal, PageHeader, Select } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/client/api';
import { useCan } from '@/lib/client/session';

export default function CategoriesPage() {
  const can = useCan();
  const q = useCategories();
  const qc = useQueryClient();
  const toast = useToast();
  const [edit, setEdit] = useState<{ id?: string; name: string } | null>(null);
  const [archive, setArchive] = useState<{ id: string; name: string; count: number } | null>(null);
  const [target, setTarget] = useState('');
  const [error, setError] = useState<unknown>(null);
  const manage = can('products.manage');
  return (
    <div>
      <PageHeader title="Categorias" description="Organize seus produtos por categoria." actions={manage && <Button onClick={() => setEdit({ name: '' })}><Plus className="size-4" />Nova categoria</Button>} />
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <EmptyState icon={<Tag className="size-5" />} title="Nenhuma categoria" action={manage ? <Button onClick={() => setEdit({ name: '' })}>Criar categoria</Button> : undefined} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {q.data?.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-2xl border border-line bg-surface p-4">
            <span className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-primary/15 text-primary-soft"><Tag className="size-4" /></span><span><span className="block font-medium">{c.name}</span><span className="text-xs text-muted">{c.productCount} produto(s)</span></span></span>
            {manage && <span className="flex gap-1">
              <button className="rounded-lg p-1.5 text-muted hover:bg-surface-3 hover:text-fg" aria-label={`Renomear ${c.name}`} onClick={() => setEdit({ id: c.id, name: c.name })}><Pencil className="size-4" /></button>
              <button className="rounded-lg p-1.5 text-muted hover:bg-danger/10 hover:text-danger-soft" aria-label={`Arquivar ${c.name}`} onClick={() => { setArchive({ id: c.id, name: c.name, count: c.productCount }); setTarget(''); }}><Trash2 className="size-4" /></button>
            </span>}
          </div>
        ))}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Renomear categoria' : 'Nova categoria'} footer={<>
        <Button variant="secondary" onClick={() => setEdit(null)}>Cancelar</Button>
        <Button onClick={async () => { setError(null); try { if (edit?.id) await api(`categories/${edit.id}`, { method: 'PATCH', body: { name: edit.name } }); else await api('categories', { body: { name: edit?.name } }); await qc.invalidateQueries({ queryKey: ['categories'] }); setEdit(null); toast('Categoria salva.'); } catch (e) { setError(e); } }}>Salvar</Button>
      </>}>
        <Field label="Nome" htmlFor="cat-name"><Input id="cat-name" value={edit?.name ?? ''} onChange={(e) => setEdit(edit && { ...edit, name: e.target.value })} /></Field>
        <div className="mt-3"><FormError error={error} /></div>
      </Modal>
      <Modal open={!!archive} onClose={() => setArchive(null)} title={`Arquivar “${archive?.name}”`} footer={<>
        <Button variant="secondary" onClick={() => setArchive(null)}>Cancelar</Button>
        <Button variant="danger" onClick={async () => { setError(null); try { await api(`categories/${archive!.id}/archive`, { body: { reassignTo: archive!.count ? target || null : undefined } }); await qc.invalidateQueries(); setArchive(null); toast('Categoria arquivada.'); } catch (e) { setError(e); } }}>Arquivar</Button>
      </>}>
        {archive && archive.count > 0 ? (
          <Field label={`Reclassificar ${archive.count} produto(s) para`} htmlFor="cat-target"><Select id="cat-target" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Sem categoria</option>{q.data?.filter((c) => c.id !== archive.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        ) : <p className="text-sm text-muted">Nenhum produto vinculado.</p>}
        <div className="mt-3"><FormError error={error} /></div>
      </Modal>
    </div>
  );
}
