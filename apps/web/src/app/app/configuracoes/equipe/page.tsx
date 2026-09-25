'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Copy, UserPlus } from 'lucide-react';
import { Badge, Button, Card, ErrorState, Field, FormError, Input, LoadingBlock, Modal, NoPermission, PageHeader, Select, Table, Td, Th } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/client/api';
import { dateBR, dateTimeBR, pct } from '@/lib/client/format';
import { useCan, useMe } from '@/lib/client/session';
import { PERMISSION_LABELS, ROLE_PERMISSIONS, type Permission, type Role } from '@gct/shared';

interface Members {
  members: { membershipId: string; userId: string; role: Role; grants: string[]; revokes: string[]; name: string; email: string; discountLimitBps: number; createdAt: string }[];
  invites: { id: string; email: string; role: string; expiresAt: string }[];
  roles: { id: Role; label: string }[];
  permissions: Permission[];
}

export default function TeamPage() {
  const can = useCan();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['members'], queryFn: () => api<Members>('members'), enabled: can('members.manage') });
  const audit = useQuery({ queryKey: ['audit'], queryFn: () => api<{ data: { id: string; action: string; entity: string; entityId: string | null; createdAt: string; userName: string | null }[] }>('audit?limit=30'), enabled: can('members.manage') });
  const [inviting, setInviting] = useState(false);
  const [inv, setInv] = useState({ email: '', role: 'seller' });
  const [link, setLink] = useState<string | null>(null);
  const [editing, setEditing] = useState<Members['members'][number] | null>(null);
  const [perm, setPerm] = useState<{ role: Role; grants: string[]; revokes: string[]; discount: string }>({ role: 'seller', grants: [], revokes: [], discount: '10' });
  const [error, setError] = useState<unknown>(null);
  if (!can('members.manage')) return <NoPermission />;
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorState error={q.error} />;
  const d = q.data!;
  const roleLabel = (r: string) => d.roles.find((x) => x.id === r)?.label ?? r;
  const effective = (role: Role, grants: string[], revokes: string[]) => new Set([...ROLE_PERMISSIONS[role], ...grants].filter((p) => !revokes.includes(p) || role === 'owner'));
  return (
    <div>
      <PageHeader title="Equipe e permissões" description="Ocultar botões não basta: cada permissão é verificada no servidor." actions={<Button onClick={() => { setInv({ email: '', role: 'seller' }); setLink(null); setError(null); setInviting(true); }}><UserPlus className="size-4" />Convidar</Button>} />
      <Card title="Membros">
        <Table>
          <thead><tr><Th>Nome</Th><Th>Papel</Th><Th right>Limite de desconto</Th><Th>Ajustes</Th><Th /></tr></thead>
          <tbody>{d.members.map((m) => (
            <tr key={m.membershipId}>
              <Td>{m.name}<div className="text-xs text-muted">{m.email}</div></Td>
              <Td><Badge tone={m.role === 'owner' ? 'primary' : 'neutral'}>{roleLabel(m.role)}</Badge></Td>
              <Td right>{m.role === 'owner' || m.role === 'manager' ? 'sem limite' : pct(m.discountLimitBps)}</Td>
              <Td className="text-xs text-muted">{m.grants.length ? `+${m.grants.length} liberada(s)` : ''} {m.revokes.length ? `−${m.revokes.length} retirada(s)` : ''}</Td>
              <Td right>{m.userId !== me.data?.user.id && <Button size="sm" variant="secondary" onClick={() => { setEditing(m); setPerm({ role: m.role, grants: m.grants, revokes: m.revokes, discount: String(m.discountLimitBps / 100) }); setError(null); }}>Editar</Button>}</Td>
            </tr>
          ))}</tbody>
        </Table>
      </Card>
      {d.invites.length > 0 && (
        <Card className="mt-4" title="Convites pendentes">
          <ul className="flex flex-col gap-2 text-sm">{d.invites.map((i) => <li key={i.id} className="flex items-center justify-between"><span>{i.email} · {roleLabel(i.role)} · expira {dateBR(i.expiresAt)}</span><Button size="sm" variant="quiet" onClick={async () => { await api(`members/invites/${i.id}`, { method: 'DELETE' }); qc.invalidateQueries({ queryKey: ['members'] }); }}>Revogar</Button></li>)}</ul>
        </Card>
      )}
      <Card className="mt-4" title="Trilha de auditoria" description="Ações críticas registradas (somente leitura).">
        {audit.data?.data.length ? <ul className="flex flex-col gap-1 text-xs">{audit.data.data.map((a) => <li key={a.id} className="flex justify-between gap-2"><span>{a.userName ?? 'sistema'} · <span className="text-muted">{a.action}</span></span><span className="text-muted">{dateTimeBR(a.createdAt)}</span></li>)}</ul> : <p className="text-sm text-muted">Sem eventos.</p>}
      </Card>
      <Modal open={inviting} onClose={() => setInviting(false)} title="Convidar membro" footer={link ? <Button onClick={() => setInviting(false)}>Concluir</Button> : <>
        <Button variant="secondary" onClick={() => setInviting(false)}>Cancelar</Button>
        <Button onClick={async () => { setError(null); try { const r = await api<{ link: string; emailSent: boolean }>('members/invites', { body: inv }); setLink(r.link); qc.invalidateQueries({ queryKey: ['members'] }); if (r.emailSent) toast('Convite enviado por e-mail.'); } catch (e) { setError(e); } }}>Gerar convite</Button>
      </>}>
        {link ? (
          <div className="flex flex-col gap-2 text-sm">
            <p>Envie este link para a pessoa. Ele expira em 7 dias e só pode ser usado uma vez, pelo e-mail convidado.</p>
            <div className="flex gap-2"><Input readOnly value={link} aria-label="Link do convite" /><Button variant="secondary" onClick={() => { navigator.clipboard.writeText(link); toast('Link copiado.'); }} aria-label="Copiar link"><Copy className="size-4" /></Button></div>
            <p className="text-xs text-muted">O envio automático por e-mail fica ativo quando o SMTP estiver configurado.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="E-mail" htmlFor="iv-e"><Input id="iv-e" type="email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></Field>
            <Field label="Papel" htmlFor="iv-r"><Select id="iv-r" value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}>{d.roles.filter((r) => r.id !== 'owner' || me.data?.current?.role === 'owner').map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</Select></Field>
            <FormError error={error} />
          </div>
        )}
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Permissões de ${editing?.name ?? ''}`} wide footer={<>
        <Button variant="danger" onClick={async () => { if (!confirm('Remover este membro da empresa?')) return; try { await api(`members/${editing!.membershipId}`, { method: 'PATCH', body: { remove: true } }); qc.invalidateQueries({ queryKey: ['members'] }); setEditing(null); toast('Membro removido.'); } catch (e) { setError(e); } }}>Remover da empresa</Button>
        <Button variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button>
        <Button onClick={async () => { setError(null); try { await api(`members/${editing!.membershipId}`, { method: 'PATCH', body: { role: perm.role, grants: perm.grants, revokes: perm.revokes, discountLimitBps: Math.round(Number(perm.discount.replace(',', '.')) * 100) } }); qc.invalidateQueries({ queryKey: ['members'] }); setEditing(null); toast('Permissões atualizadas.'); } catch (e) { setError(e); } }}>Salvar</Button>
      </>}>
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Papel" htmlFor="pm-r"><Select id="pm-r" value={perm.role} onChange={(e) => setPerm({ ...perm, role: e.target.value as Role, grants: [], revokes: [] })}>{d.roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</Select></Field>
            <Field label="Limite de desconto (%)" htmlFor="pm-d" help="Acima disso exige a permissão “Desconto acima do limite”."><Input id="pm-d" inputMode="decimal" value={perm.discount} onChange={(e) => setPerm({ ...perm, discount: e.target.value })} /></Field>
          </div>
          <fieldset>
            <legend className="mb-2 text-xs text-muted">Permissões efetivas (marque para liberar além do papel; desmarque para retirar)</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {d.permissions.map((p) => {
                const base = ROLE_PERMISSIONS[perm.role].includes(p);
                const on = effective(perm.role, perm.grants, perm.revokes).has(p);
                return (
                  <label key={p} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="accent-[var(--color-primary)]" checked={on} disabled={perm.role === 'owner'} onChange={(e) => {
                      const want = e.target.checked;
                      setPerm((s) => ({ ...s, grants: base ? s.grants.filter((x) => x !== p) : want ? [...s.grants, p] : s.grants.filter((x) => x !== p), revokes: base ? (want ? s.revokes.filter((x) => x !== p) : [...s.revokes, p]) : s.revokes.filter((x) => x !== p) }));
                    }} />
                    {PERMISSION_LABELS[p]}{!base && on && <span className="text-[10px] text-primary-soft">extra</span>}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <FormError error={error} />
        </div>
      </Modal>
    </div>
  );
}
