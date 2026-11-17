/** Everything is stored in UTC and shown in the viewer's own zone. */
export const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local

export function formatDue(due: string): string {
  const [y, m, d] = due.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

export const formatTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

export function formatDay(iso: string): string {
  const date = new Date(iso);
  const local = date.toLocaleDateString("en-CA");
  if (local === today()) return "Today";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) });
}
