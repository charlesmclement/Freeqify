export function duration(seconds: number | null) {
  if (seconds === null) return '—';
  const value = Math.floor(seconds);
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
