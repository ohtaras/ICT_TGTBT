const GR = 'Europe/Athens';

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('el-GR', {
    timeZone: GR, day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('el-GR', {
    timeZone: GR, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export function fmtDateTime(ts: number): string {
  return `${fmtDate(ts)} ${fmtTime(ts)}`;
}

export function fmtDayHeader(ts: number): string {
  return new Date(ts).toLocaleDateString('el-GR', {
    timeZone: GR, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}
