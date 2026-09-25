/**
 * Permissões granulares. Papéis são conjuntos padrão; a empresa pode ajustar
 * permissões por membro (grants/revokes). "Configurável" = negado por padrão.
 */
export const PERMISSIONS = [
  'dashboard.view',
  'products.view',
  'products.manage',
  'costs.view',
  'parties.view',
  'parties.manage',
  'sales.create',
  'sales.view',
  'sales.discount_over_limit',
  'trades.confirm',
  'purchases.manage',
  'purchases.receive',
  'inventory.adjust',
  'finance.view',
  'finance.settle_receivable',
  'finance.settle_payable',
  'finance.manage',
  'reversals.execute',
  'reports.view',
  'data.export',
  'members.manage',
  'settings.manage',
  'billing.manage',
  'catalog.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ['owner', 'manager', 'seller', 'stock', 'finance', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Proprietário',
  manager: 'Gestor',
  seller: 'Vendedor',
  stock: 'Estoque',
  finance: 'Financeiro',
  viewer: 'Consulta',
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  'dashboard.view': 'Ver painel',
  'products.view': 'Ver produtos',
  'products.manage': 'Cadastrar/editar produtos',
  'costs.view': 'Ver custo e lucro',
  'parties.view': 'Ver clientes e fornecedores',
  'parties.manage': 'Cadastrar clientes e fornecedores',
  'sales.create': 'Registrar vendas',
  'sales.view': 'Ver vendas',
  'sales.discount_over_limit': 'Desconto acima do limite',
  'trades.confirm': 'Concluir trocas',
  'purchases.manage': 'Criar e confirmar compras',
  'purchases.receive': 'Receber mercadorias',
  'inventory.adjust': 'Ajustar estoque',
  'finance.view': 'Ver financeiro',
  'finance.settle_receivable': 'Baixar contas a receber',
  'finance.settle_payable': 'Baixar contas a pagar',
  'finance.manage': 'Gerir contas, despesas e caixa',
  'reversals.execute': 'Estornar e devolver',
  'reports.view': 'Ver relatórios',
  'data.export': 'Exportar dados',
  'members.manage': 'Gerir membros e permissões',
  'settings.manage': 'Configurações da empresa',
  'billing.manage': 'Gerir assinatura',
  'catalog.manage': 'Gerir catálogo público',
};

const ALL = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: ALL,
  manager: ALL.filter((p) => !['members.manage', 'billing.manage', 'reversals.execute', 'data.export'].includes(p)),
  seller: ['dashboard.view', 'products.view', 'parties.view', 'parties.manage', 'sales.create', 'sales.view'],
  stock: ['dashboard.view', 'products.view', 'products.manage', 'purchases.receive', 'parties.view'],
  finance: [
    'dashboard.view',
    'products.view',
    'costs.view',
    'parties.view',
    'sales.view',
    'finance.view',
    'finance.settle_receivable',
    'finance.settle_payable',
    'finance.manage',
    'reports.view',
    'data.export',
  ],
  viewer: ['dashboard.view', 'products.view', 'sales.view'],
};

export function effectivePermissions(
  role: Role,
  grants: readonly string[] = [],
  revokes: readonly string[] = [],
): Set<Permission> {
  const set = new Set<Permission>(ROLE_PERMISSIONS[role]);
  for (const g of grants) if ((PERMISSIONS as readonly string[]).includes(g)) set.add(g as Permission);
  for (const r of revokes) set.delete(r as Permission);
  if (role === 'owner') for (const p of ALL) set.add(p);
  return set;
}
