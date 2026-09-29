'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export interface PaymentMethod { id: string; name: string; kind: string; feeBps: number; installmentFeeBps: Record<string, number>; settlementDays: number; accountId: string | null; accountName: string | null; active: boolean }
export interface Account { id: string; name: string; kind: string; status: string; balanceCents: string; openSession: string | null }
export interface Channel { id: string; name: string; commissionBps: number; active: boolean }

export const usePaymentMethods = () => useQuery({ queryKey: ['payment-methods'], queryFn: () => api<PaymentMethod[]>('payment-methods') });
export const useChannels = () => useQuery({ queryKey: ['channels'], queryFn: () => api<Channel[]>('channels') });
/** Contas ativas (as arquivadas, por exemplo depois de unificar, ficam só no histórico). */
export const useAccounts = (enabled = true) => useQuery({ queryKey: ['accounts'], queryFn: () => api<Account[]>('finance/accounts'), enabled, select: (rows) => rows.filter((a) => a.status === 'active') });
export const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: () => api<{ id: string; name: string; productCount: number }[]>('categories') });
