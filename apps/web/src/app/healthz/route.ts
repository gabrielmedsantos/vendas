export const dynamic = 'force-dynamic';
/** Saúde do processo (não toca o banco). Mostra só o código curto da versão no ar, para conferir as atualizações. */
export function GET() {
  const v = (process.env.APP_VERSION ?? '').replace(/[^0-9a-f]/gi, '').slice(0, 7);
  return Response.json({ status: 'ok', ...(v ? { version: v } : {}) });
}
