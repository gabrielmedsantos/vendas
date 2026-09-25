import Link from 'next/link';
import { Logo } from '@/components/brand/logo';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5">
        <Link href="/" aria-label="Início">
          <Logo />
        </Link>
      </header>
      <main className="relative z-10 flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center">{children}</main>
    </div>
  );
}
