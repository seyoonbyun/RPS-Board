// 가짜 Google Sheets API — 실제 한도(서비스 계정 1개 = 사용자 1명: 읽기·쓰기 각각 분당 60건)를 흉내 낸다.
// 실제 회원 데이터는 쓰지 않는다. 합성 회원만 들어 있다.
import http from 'node:http';

const READ_LIMIT = Number(process.env.FAKE_READ_PER_MIN || 60);
const WRITE_LIMIT = Number(process.env.FAKE_WRITE_PER_MIN || 60);

function colToIdx(c) { let n = 0; for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
function parseRange(range) {
  // "RPS!A1:Z5000" | "ActivityLog!A:D" | "RPS!U5:V5" | "ActivityLog!A1"
  const [sheet, ref = ''] = decodeURIComponent(range).split('!');
  const m = ref.match(/^([A-Z]+)?(\d+)?(?::([A-Z]+)?(\d+)?)?$/) || [];
  return {
    sheet,
    c1: m[1] ? colToIdx(m[1]) : 0,
    r1: m[2] ? Number(m[2]) - 1 : 0,
    c2: m[3] ? colToIdx(m[3]) : (m[1] && !m[3] && !m[4] ? colToIdx(m[1]) : 25),
    r2: m[4] ? Number(m[4]) - 1 : (m[2] && !m[3] && !m[4] ? Number(m[2]) - 1 : Infinity),
  };
}

export function startFakeGoogle({ port, sheets }) {
  const stats = { reads: 0, writes: 0, throttled: 0, byPath: {} };
  const win = { read: [], write: [] };
  const allow = (kind) => {
    const now = Date.now();
    const arr = win[kind].filter((t) => t > now - 60_000);
    win[kind] = arr;
    if (arr.length >= (kind === 'read' ? READ_LIMIT : WRITE_LIMIT)) return false;
    arr.push(now);
    return true;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const url = new URL(req.url, 'http://x');
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

    if (url.pathname === '/__state') return send(200, { stats, sheets });

    const pathname = decodeURIComponent(url.pathname);
    // m[1]=범위, m[2]='append', m[3]=values:batchUpdate, m[4]=스프레드시트 batchUpdate(addSheet)
    let m = null;
    let mm;
    if ((mm = pathname.match(/^\/v4\/spreadsheets\/[^/]+\/values:batchUpdate$/))) m = [null, null, null, 'batchUpdate', null];
    else if ((mm = pathname.match(/^\/v4\/spreadsheets\/[^/:]+:batchUpdate$/))) m = [null, null, null, null, 'batchUpdate'];
    else if ((mm = pathname.match(/^\/v4\/spreadsheets\/[^/]+\/values\/(.+?)(:append)?$/))) m = [null, mm[1], mm[2] ? 'append' : null, null, null];
    if (!m) return send(404, { error: 'unknown ' + pathname });
    const kind = req.method === 'GET' ? 'read' : 'write';
    const key = `${req.method} ${m[2] || m[3] || (m[4] ? 'sheetBatchUpdate' : 'values')}`;
    stats.byPath[key] = (stats.byPath[key] || 0) + 1;
    if (!allow(kind)) { stats.throttled++; await sleep(30); return send(429, { error: { code: 429, message: 'Quota exceeded' } }); }
    kind === 'read' ? stats.reads++ : stats.writes++;

    if (m[4]) { // addSheet
      const reqs = JSON.parse(body || '{}').requests || [];
      for (const r of reqs) if (r.addSheet) sheets[r.addSheet.properties.title] ??= [];
      await sleep(200);
      return send(200, {});
    }
    if (m[3]) { // values:batchUpdate
      const data = JSON.parse(body).data || [];
      for (const d of data) writeRange(d.range, d.values);
      await sleep(250 + data.length * 2);
      return send(200, { totalUpdatedRows: data.length });
    }
    const range = m[1];
    const p = parseRange(range);
    if (!sheets[p.sheet]) { await sleep(100); return send(400, { error: { code: 400, message: 'Unable to parse range' } }); }
    if (req.method === 'GET') {
      const rows = sheets[p.sheet];
      const out = [];
      for (let r = p.r1; r <= Math.min(p.r2, rows.length - 1); r++) out.push((rows[r] || []).slice(p.c1, p.c2 + 1));
      while (out.length && out[out.length - 1].every((v) => v === '' || v == null)) out.pop();
      await sleep(150 + Math.min(900, out.length / 3) + Math.random() * 150);
      return send(200, { range, values: out });
    }
    const values = JSON.parse(body || '{}').values || [];
    if (m[2] === 'append') {
      sheets[p.sheet].push(...values.map((v) => [...v]));
      await sleep(200 + Math.random() * 100);
      return send(200, { updates: { updatedRows: values.length } });
    }
    writeRange(range, values);
    await sleep(200 + Math.random() * 100);
    return send(200, { updatedRows: values.length });
  });

  function writeRange(range, values) {
    const p = parseRange(range);
    const rows = sheets[p.sheet];
    values.forEach((v, i) => {
      const r = p.r1 + i;
      while (rows.length <= r) rows.push([]);
      const row = rows[r];
      v.forEach((cell, j) => { row[p.c1 + j] = cell == null ? '' : String(cell); });
    });
  }

  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, stats, sheets })));
}
