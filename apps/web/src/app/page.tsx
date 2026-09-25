import Link from 'next/link';
import { ArrowLeftRight, BarChart3, Boxes, ShieldCheck, Wallet } from 'lucide-react';
import { Logo } from '@/components/brand/logo';

const FEATURES = [
  { icon: ArrowLeftRight, title: 'Troca com diferença', text: 'Entrega e recebimento na mesma operação, com compensação sem dinheiro fictício e cobrança só da diferença.' },
  { icon: Boxes, title: 'Estoque por lote e por unidade', text: 'Custo FIFO para quantidade e custo específico para usados com IMEI/série, inspeção e histórico.' },
  { icon: Wallet, title: 'Financeiro que fecha', text: 'Contas a receber e a pagar, caixa, taxas de cartão, crédito da loja e estornos rastreáveis.' },
  { icon: BarChart3, title: 'Resultado gerencial', text: 'Receita, CMV, margem e caixa com as fórmulas visíveis e os mesmos números no painel e nos relatórios.' },
];

export default function Home() {
  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute -top-48 right-[-10%] h-[520px] w-[720px] rounded-full bg-primary/25 blur-[140px]" />
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <Logo />
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/entrar" className="rounded-xl px-3 py-2 text-muted hover:text-fg">Entrar</Link>
          <Link href="/cadastro" className="rounded-xl bg-primary-btn px-4 py-2 font-medium text-white hover:bg-primary-btn-hover">Criar conta</Link>
        </nav>
      </header>
      <main className="relative z-10 mx-auto max-w-6xl px-4 pb-20 pt-10 sm:pt-20">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary-soft">Compra · Venda · Troca</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          A operação de quem compra, vende e <span className="text-primary">troca</span>, com números que batem.
        </h1>
        <p className="mt-5 max-w-2xl text-base text-muted sm:text-lg">
          Estoque, clientes, fornecedores, caixa e lucro de várias empresas isoladas num só lugar. Feito para lojas de usados, eletrônicos, roupas e acessórios.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/cadastro" className="rounded-xl bg-primary-btn px-5 py-3 text-sm font-medium text-white shadow-[0_10px_40px_-10px_rgba(138,98,255,0.8)] hover:bg-primary-btn-hover">
            Começar teste gratuito
          </Link>
          <Link href="/entrar" className="rounded-xl border border-line-strong bg-surface-3 px-5 py-3 text-sm font-medium hover:bg-line-strong">
            Já tenho conta
          </Link>
        </div>
        <section className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Recursos">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-line bg-surface p-5">
              <f.icon className="size-5 text-primary-soft" aria-hidden />
              <h2 className="mt-3 font-semibold">{f.title}</h2>
              <p className="mt-1 text-sm text-muted">{f.text}</p>
            </div>
          ))}
        </section>
        <p className="mt-10 flex items-center gap-2 text-xs text-muted">
          <ShieldCheck className="size-4" aria-hidden /> Dados de cada empresa isolados no banco. Recibos são documentos comerciais, sem valor fiscal.
        </p>
      </main>
    </div>
  );
}
