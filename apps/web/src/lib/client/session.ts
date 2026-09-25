'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface Me {
  user: { id: string; email: string; name: string; emailVerified: boolean; twoFactorEnabled?: boolean | null };
  tenants: { id: string; name: string; slug: string; role: string; status: string }[];
  current: null | {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    status: 'active' | 'suspended' | 'archived';
    role: string;
    roleLabel: string;
    permissions: string[];
    discountLimitBps: number;
  };
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('me'), staleTime: 60_000 });
}

export function useCan() {
  const { data } = useMe();
  const perms = new Set(data?.current?.permissions ?? []);
  return (p: string) => perms.has(p);
}
