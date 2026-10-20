export type PreviewRecord = { id: number; customer: string; amount: string; created_at: string };
export const PREVIEW_RECORDS: Record<string, PreviewRecord[]> = {
  orders: [
    { id: 1001, customer: 'Northwind', amount: '128.00', created_at: '2026-10-14 09:20:00' },
    { id: 1002, customer: 'Adventure Works', amount: '256.50', created_at: '2026-10-14 10:35:00' },
    { id: 1003, customer: 'Contoso', amount: '89.00', created_at: '2026-10-15 11:10:00' },
    { id: 1004, customer: 'Fabrikam', amount: '365.00', created_at: '2026-10-15 14:45:00' },
  ],
  customers: [
    { id: 1, customer: 'Northwind', amount: '128.00', created_at: '2026-10-12 08:00:00' },
    { id: 2, customer: 'Contoso', amount: '89.00', created_at: '2026-10-13 09:00:00' },
  ],
};
export const INITIAL_PREVIEW_SQL = 'SELECT id, customer, amount, created_at\nFROM orders\nLIMIT 100;';
export function runPreviewQuery(sql: string): { table: string; rows: PreviewRecord[] } | null {
  if (!/^\s*select\b/i.test(sql) || /;\s*\S/.test(sql.trim().replace(/;$/, ''))) return null;
  const table = /\bfrom\s+[`"\[]?(orders|customers)\b/i.exec(sql)?.[1]?.toLowerCase();
  if (!table) return null;
  const limit = /\blimit\s+(\d+)/i.exec(sql)?.[1];
  return { table, rows: PREVIEW_RECORDS[table].slice(0, limit ? Math.min(100, Number(limit)) : undefined) };
}
