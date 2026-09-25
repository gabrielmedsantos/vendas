'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Button, Card, FormError } from '@/components/ui';
import { api, ApiError } from '@/lib/client/api';

export function ProductPhotos({ productId, images, canManage }: { productId: string; images: { attachmentId: string }[]; canManage: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setError(null);
    try {
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', f);
        const res = await fetch(`/api/v1/products/${productId}/images`, { method: 'POST', body: fd, credentials: 'same-origin' });
        if (!res.ok) { const e = (await res.json()).error; throw new ApiError(res.status, e.code, e.message, e.fields, e.requestId); }
      }
      await qc.invalidateQueries({ queryKey: ['product', productId] });
    } catch (e) { setError(e); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  return (
    <Card title="Fotos" description="JPEG, PNG ou WebP até 5 MB (máx. 10). Reprocessadas sem metadados de localização." action={canManage && (
      <>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" id="photo-input" onChange={(e) => upload(e.target.files)} />
        <Button size="sm" variant="secondary" loading={busy} onClick={() => input.current?.click()}><ImagePlus className="size-4" />Adicionar</Button>
      </>
    )}>
      {images.length === 0 ? <p className="text-sm text-muted">Nenhuma foto.</p> : (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {images.map((i) => (
            <li key={i.attachmentId} className="group relative aspect-square overflow-hidden rounded-xl border border-line bg-bg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/v1/attachments/${i.attachmentId}`} alt="Foto do produto" className="size-full object-cover" loading="lazy" />
              {canManage && <button aria-label="Remover foto" onClick={async () => { await api(`products/${productId}/images/${i.attachmentId}`, { method: 'DELETE' }); qc.invalidateQueries({ queryKey: ['product', productId] }); }} className="absolute right-1 top-1 rounded-lg bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100"><Trash2 className="size-3.5" /></button>}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2"><FormError error={error} /></div>
    </Card>
  );
}
