import {
  ArrowDownUp, ArrowLeftRight, BarChart3, Boxes, Building2, ClipboardList, CreditCard, FileText, HandCoins, Home, LifeBuoy, Package, Receipt, Settings,
  ShieldCheck, ShoppingBag, ShoppingCart, Store, Tags, Users, Wallet, Wrench, type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  perm?: string;
  anyPerm?: string[];
}

export const NAV: { group: string; items: NavItem[] }[] = [
  { group: '', items: [{ href: '/app', label: 'Início', icon: Home, perm: 'dashboard.view' }] },
  {
    group: 'Operação',
    items: [
      { href: '/app/vendas', label: 'Vendas', icon: ShoppingCart, perm: 'sales.view' },
      { href: '/app/trocas', label: 'Trocas', icon: ArrowLeftRight, perm: 'sales.view' },
      { href: '/app/servicos', label: 'Serviços', icon: Wrench, perm: 'sales.view' },
      { href: '/app/garantias', label: 'Garantias', icon: ShieldCheck, perm: 'sales.view' },
      { href: '/app/produtos', label: 'Produtos', icon: Package, perm: 'products.view' },
      { href: '/app/compras', label: 'Compras', icon: ShoppingBag, anyPerm: ['purchases.manage', 'purchases.receive'] },
      { href: '/app/categorias', label: 'Categorias', icon: Tags, perm: 'products.view' },
      { href: '/app/estoque', label: 'Estoque', icon: Boxes, perm: 'products.view' },
    ],
  },
  {
    group: 'Financeiro',
    items: [
      { href: '/app/financeiro', label: 'Fluxo de caixa', icon: ArrowDownUp, perm: 'finance.view' },
      { href: '/app/financeiro/receber', label: 'A receber', icon: HandCoins, perm: 'finance.view' },
      { href: '/app/financeiro/pagar', label: 'A pagar', icon: CreditCard, perm: 'finance.view' },
      { href: '/app/financeiro/despesas', label: 'Despesas', icon: Receipt, perm: 'finance.view' },
      { href: '/app/relatorios', label: 'Relatórios', icon: BarChart3, perm: 'reports.view' },
    ],
  },
  {
    group: 'Cadastros',
    items: [{ href: '/app/pessoas', label: 'Clientes e fornecedores', icon: Users, perm: 'parties.view' }],
  },
  {
    group: 'Vendas online',
    items: [{ href: '/app/catalogo', label: 'Catálogo', icon: Store, perm: 'catalog.manage' }],
  },
  {
    group: 'Configurações',
    items: [
      { href: '/app/configuracoes', label: 'Empresa', icon: Building2, perm: 'settings.manage' },
      { href: '/app/configuracoes/equipe', label: 'Equipe e permissões', icon: Settings, perm: 'members.manage' },
      { href: '/app/configuracoes/pagamentos', label: 'Canais e pagamentos', icon: Wallet, perm: 'settings.manage' },
      { href: '/app/configuracoes/documentos', label: 'Documentos', icon: FileText, perm: 'sales.view' },
      { href: '/app/configuracoes/plano', label: 'Plano', icon: ClipboardList },
      { href: '/app/ajuda', label: 'Ajuda', icon: LifeBuoy },
    ],
  },
];

export const MOBILE_TABS = ['/app', '/app/vendas', '/app/trocas', '/app/produtos'];
