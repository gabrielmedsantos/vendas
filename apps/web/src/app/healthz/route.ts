export const dynamic = 'force-dynamic';
/** Saúde do processo (não toca o banco, não revela versão/ambiente). */
export function GET() {
  return Response.json({ status: 'ok' });
}
