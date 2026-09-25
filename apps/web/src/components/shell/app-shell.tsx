'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Bell, Check, ChevronsUpDown, LogOut, Menu, X } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { Badge, cx, LoadingBlock } from '@/components/ui';
import { api } from '@/lib/client/api';
import { authClient } from '@/lib/client/auth';
import { useMe } from '@/lib/client/session';
import { dateTimeBR, STATUS_LABEL } from '@/lib/client/format';
import { MOBILE_TABS, NAV, type NavItem } from './nav';

function visible(item: NavItem, perms: Set<string>) {
  if (item.perm && !perms.has(item.perm)) return false;
  if (item.anyPerm && !item.anyPerm.some((p) => perms.has(p))) return false;
  return true;
}

function isActive(path: string, href: string) {
  return href === '/app' ? path === '/app' : path === href || path.startsWith(href + '/');
}

function NavList({ perms, path, onNavigate }: { perms: Set<string>; path: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Principal" className="flex flex-col gap-4">
      {NAV.map((g) => {
        const items = g.items.filter((i) => visible(i, perms));
        if (!items.length) return null;
        return (
          <div key={g.group || 'root'}>
            {g.group && <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted/80">{g.group}</p>}
            <ul className="flex flex-col gap-0.5">
              {items.map((i) => {
                const active = isActive(path, i.href) && !NAV.flatMap((x) => x.items).some((o) => o.href !== i.href && o.href.startsWith(i.href) && isActive(path, o.href));
                return (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cx(
                        'flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors',
                        active ? 'bg-primary/15 text-fg shadow-[inset_2px_0_0_var(--color-primary)]' : 'text-muted hover:bg-surface-3 hover:text-fg',
                      )}
                    >
                      <i.icon className={cx('size-4', active && 'text-primary-soft')} aria-hidden />
                      {i.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function TenantSwitcher() {
  const { data } = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!data?.current) return null;
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-bg px-3 py-2 text-left text-sm hover:border-line-strong">
        <span className="min-w-0">
          <span className="block truncate font-medium">{data.current.name}</span>
          <span className="block text-[11px] text-muted">{data.current.roleLabel}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted" />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 rounded-xl border border-line bg-surface-2 p-1 shadow-xl">
          {data.tenants.map((t) => (
            <button
              key={t.id}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-3"
              onClick={async () => {
                await api('session/tenant', { body: { tenantId: t.id } });
                setOpen(false);
                qc.clear(); // troca de empresa limpa caches e filtros dependentes
                router.push('/app');
              }}
            >
              <span className="truncate">{t.name}</span>
              {t.id === data.current?.id && <Check className="size-4 text-primary-soft" />}
            </button>
          ))}
          <Link href="/app/empresas" className="block rounded-lg px-3 py-2 text-sm text-primary-soft hover:bg-surface-3" onClick={() => setOpen(false)}>
            + Nova empresa
          </Link>
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ data: { id: string; title: string; body: string | null; link: string | null; severity: string; readAt: string | null; createdAt: string }[]; unread: number }>('notifications'), refetchInterval: 60_000 });
  const qc = useQueryClient();
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="relative rounded-xl border border-line p-2 text-muted hover:text-fg" aria-label={`Notificações${q.data?.unread ? `, ${q.data.unread} não lidas` : ''}`}>
        <Bell className="size-4" />
        {!!q.data?.unread && <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-danger text-[10px] font-bold text-white">{q.data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-2xl border border-line bg-surface-2 p-2 shadow-2xl">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-sm font-medium">Notificações</span>
            <button className="text-xs text-primary-soft" onClick={async () => { await api('notifications/read-all', { method: 'POST' }); qc.invalidateQueries({ queryKey: ['notifications'] }); }}>Marcar todas como lidas</button>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {q.data?.data.length ? q.data.data.map((n) => (
              <li key={n.id} className={cx('rounded-xl px-3 py-2', !n.readAt && 'bg-surface-3')}>
                <p className="text-sm font-medium">{n.title}</p>
                {n.body && <p className="text-xs text-muted">{n.body}</p>}
                <p className="mt-1 text-[10px] text-muted">{dateTimeBR(n.createdAt)}</p>
              </li>
            )) : <li className="px-3 py-6 text-center text-sm text-muted">Nenhuma notificação.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const me = useMe();
  const [drawer, setDrawer] = useState(false);
  const needsTenant = me.data && !me.data.current;
  useEffect(() => {
    if (needsTenant && path !== '/app/empresas') router.replace('/app/empresas');
  }, [needsTenant, path, router]);
  const perms = new Set(me.data?.current?.permissions ?? []);

  if (me.isLoading) return <div className="p-6"><LoadingBlock rows={6} /></div>;
  if (path === '/app/empresas' || needsTenant) return <div className="mx-auto max-w-3xl px-4 py-10">{children}</div>;

  const signOut = async () => {
    await authClient.signOut();
    window.location.href = '/entrar';
  };
  const sidebar = (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <Logo />
      </div>
      <TenantSwitcher />
      <div className="flex-1 overflow-y-auto pr-1">
        <NavList perms={perms} path={path} onNavigate={() => setDrawer(false)} />
      </div>
      <div className="rounded-xl border border-line p-3">
        <p className="truncate text-sm font-medium">{me.data?.user.name}</p>
        <p className="truncate text-xs text-muted">{me.data?.user.email}</p>
        <button onClick={signOut} className="mt-2 flex items-center gap-2 text-xs text-muted hover:text-fg"><LogOut className="size-3.5" /> Sair</button>
      </div>
    </div>
  );
  return (
    <div className="flex min-h-dvh">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface-2 focus:px-3 focus:py-2">Pular para o conteúdo</a>
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-line bg-surface lg:block">{sidebar}</aside>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-line bg-surface">
            <button className="absolute right-3 top-4 rounded-lg p-1 text-muted" onClick={() => setDrawer(false)} aria-label="Fechar menu"><X className="size-5" /></button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3">
            <button className="rounded-xl border border-line p-2 lg:hidden" onClick={() => setDrawer(true)} aria-label="Abrir menu"><Menu className="size-4" /></button>
            <span className="text-sm text-muted lg:hidden">{me.data?.current?.name}</span>
          </div>
          <div className="flex items-center gap-2">
            {me.data?.current?.status !== 'active' && <Badge tone="warning">{STATUS_LABEL[me.data?.current?.status ?? ''] ?? 'Restrito'}</Badge>}
            <Notifications />
          </div>
        </header>
        {me.data?.current?.status === 'suspended' && (
          <div role="alert" className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning lg:px-8">
            Empresa suspensa por pendência de assinatura: consultas e exportações continuam disponíveis; novas operações estão bloqueadas.
          </div>
        )}
        <main id="conteudo" className="mx-auto w-full max-w-7xl flex-1 px-4 pb-28 pt-6 lg:px-8 lg:pb-10">{children}</main>
        <nav aria-label="Atalhos" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/95 backdrop-blur lg:hidden">
          {NAV.flatMap((g) => g.items).filter((i) => MOBILE_TABS.includes(i.href) && visible(i, perms)).map((i) => (
            <Link key={i.href} href={i.href} aria-current={isActive(path, i.href) ? 'page' : undefined} className={cx('flex flex-col items-center gap-1 py-2.5 text-[11px]', isActive(path, i.href) ? 'text-primary-soft' : 'text-muted')}>
              <i.icon className="size-5" aria-hidden />
              {i.label}
            </Link>
          ))}
          <button onClick={() => setDrawer(true)} className="flex flex-col items-center gap-1 py-2.5 text-[11px] text-muted"><Menu className="size-5" aria-hidden />Mais</button>
        </nav>
      </div>
    </div>
  );
}
