export const toLocalDateTimeInput = (value: string): string => {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

export const fromLocalDateTimeInput = (value: string): string => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
};
