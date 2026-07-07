export function formatLocalIso(ms: number): string {
  const d = new Date(ms);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const year = d.getFullYear();
  const month = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hours = pad2(d.getHours());
  const minutes = pad2(d.getMinutes());
  const seconds = pad2(d.getSeconds());
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const absMin = Math.abs(offsetMin);
  const offH = pad2(Math.floor(absMin / 60));
  const offM = pad2(absMin % 60);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offH}:${offM} (${zone})`;
}

const TERMINAL_STATUSES = new Set(["finished", "errored", "stopped", "zombie_killed"]);

export function selectUnreported<T extends { status: string; waitReported: boolean; exitedAt: number | null }>(
  list: T[]
): T[] {
  return list.filter(
    (a) => TERMINAL_STATUSES.has(a.status) && a.exitedAt !== null && !a.waitReported
  );
}

export function selectUnreportedPermissionRequested<
  T extends { status: string; waitReported: boolean }
>(list: T[]): T[] {
  return list.filter((a) => a.status === "permission_requested" && !a.waitReported);
}
