import { conflict } from '@gct/shared';

type Machine<S extends string> = Record<S, readonly S[]>;

export const SALE_TRANSITIONS: Machine<'draft' | 'confirmed' | 'canceled' | 'partially_returned' | 'returned' | 'reversed'> = {
  draft: ['confirmed', 'canceled'],
  confirmed: ['partially_returned', 'returned', 'reversed'],
  partially_returned: ['partially_returned', 'returned'],
  returned: [],
  canceled: [],
  reversed: [],
};

export const PURCHASE_TRANSITIONS: Machine<'draft' | 'approved' | 'partially_received' | 'received' | 'canceled'> = {
  draft: ['approved', 'canceled'],
  approved: ['partially_received', 'received', 'canceled'],
  partially_received: ['partially_received', 'received'],
  received: [],
  canceled: [],
};

export const UNIT_TRANSITIONS: Machine<'inspection' | 'available' | 'reserved' | 'sold' | 'repair' | 'lost' | 'returned_to_supplier'> = {
  inspection: ['available', 'repair', 'lost', 'returned_to_supplier'],
  available: ['reserved', 'sold', 'repair', 'lost', 'inspection', 'returned_to_supplier'],
  reserved: ['available', 'sold'],
  sold: ['inspection'],
  repair: ['available', 'inspection', 'lost'],
  lost: [],
  returned_to_supplier: [],
};

export const SUBSCRIPTION_TRANSITIONS: Machine<'trialing' | 'active' | 'past_due' | 'suspended' | 'canceled'> = {
  trialing: ['active', 'past_due', 'suspended', 'canceled'],
  active: ['past_due', 'canceled', 'active'],
  past_due: ['active', 'suspended', 'canceled'],
  suspended: ['active', 'canceled'],
  canceled: ['active'],
};

export function assertTransition<S extends string>(machine: Machine<S>, from: S, to: S, what = 'registro'): void {
  if (!machine[from]?.includes(to)) throw conflict(`Não é possível mudar ${what} de "${from}" para "${to}".`);
}
