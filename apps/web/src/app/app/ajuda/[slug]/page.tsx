'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Card, ErrorState, LoadingBlock } from '@/components/ui';
import { api } from '@/lib/client/api';
import { dateBR } from '@/lib/client/format';

interface Article { slug: string; title: string; summary: string; body: string; readingMinutes: number; updatedAt: string }

/** Texto simples: parágrafos, listas com "- " e "1. ". Sem HTML vindo do banco. */
function Body({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed">
      {text.split(/\n{2,}/).map((block, i) => {
        const lines = block.split('\n');
        if (lines.every((l) => /^- /.test(l))) return <ul key={i} className="list-disc pl-5">{lines.map((l, j) => <li key={j}>{l.slice(2)}</li>)}</ul>;
        if (lines.every((l) => /^\d+\. /.test(l))) return <ol key={i} className="list-decimal pl-5">{lines.map((l, j) => <li key={j}>{l.replace(/^\d+\. /, '')}</li>)}</ol>;
        if (lines.length > 1 && lines.slice(1).every((l) => /^- /.test(l))) return <div key={i}><p>{lines[0]}</p><ul className="mt-1 list-disc pl-5">{lines.slice(1).map((l, j) => <li key={j}>{l.slice(2)}</li>)}</ul></div>;
        return <p key={i}>{block}</p>;
      })}
    </div>
  );
}

export default function HelpArticlePage() {
  const { slug } = useParams<{ slug: string }>();
  const q = useQuery({ queryKey: ['help', slug], queryFn: () => api<Article>(`help/${slug}`) });
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/app/ajuda" className="mb-3 inline-flex items-center gap-1 text-sm text-primary-soft hover:underline"><ArrowLeft className="size-4" />Central de ajuda</Link>
      {q.isLoading ? <LoadingBlock /> : q.error ? <ErrorState error={q.error} /> : q.data && (
        <Card>
          <h1 className="text-xl font-semibold">{q.data.title}</h1>
          <p className="mb-4 mt-1 text-xs text-muted">{q.data.readingMinutes} min de leitura · atualizado em {dateBR(q.data.updatedAt)}</p>
          <Body text={q.data.body} />
        </Card>
      )}
    </div>
  );
}
