const HEADER_LEN = 60;

function pad(s: string, n = HEADER_LEN): string {
  return s.padEnd(n);
}

export function createLog(name: string, mode?: string) {
  const startTime = Date.now();

  function ts(): string {
    return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z/, '');
  }

  function fmtDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  }

  function header() {
    const dateStr = ts();
    const modeStr = mode ? ` | ${mode}` : '';
    console.log('');
    console.log(`════════════════════════════════════════════════════════`);
    console.log(`  ${name}${modeStr}`);
    console.log(`  ${dateStr}`);
    console.log(`════════════════════════════════════════════════════════`);
    console.log('');
  }

  function section(title: string) {
    console.log(`── ${title} ${'─'.repeat(Math.max(1, HEADER_LEN - 6 - title.length))}`);
  }

  function start(msg: string, meta?: Record<string, unknown>) {
    const m = meta ? Object.entries(meta).map(([k, v]) => `${k}=${v}`).join(' ') : '';
    console.log(`  ▶ ${msg}${m ? ' ' + m : ''}`);
  }

  function success(msg: string, meta?: Record<string, unknown>) {
    const m = meta ? Object.entries(meta).map(([k, v]) => `${k}=${v}`).join(' ') : '';
    console.log(`  ✓ ${msg}${m ? ' ' + m : ''}`);
  }

  function skip(msg: string) {
    console.log(`  ⏭ ${msg}`);
  }

  function warn(msg: string) {
    console.log(`  ⚠ ${msg}`);
  }

  function error(msg: string) {
    console.log(`  ✗ ${msg}`);
  }

  function retry(msg: string, attempt: number, max: number) {
    console.log(`  ↻ ${msg} (${attempt}/${max})`);
  }

  function info(msg: string) {
    console.log(`  · ${msg}`);
  }

  function summary(processed: number, errors: number) {
    const dur = fmtDuration(Date.now() - startTime);
    console.log('');
    console.log(`── SUMMARY ${'─'.repeat(Math.max(1, HEADER_LEN - 12))}`);
    console.log(`  Processed: ${processed} | Errors: ${errors} | Duration: ${dur}`);
    console.log(`──────────────────────────────────────────────────────`);
    console.log('');
  }

  return { header, section, start, success, skip, warn, error, retry, info, summary };
}
