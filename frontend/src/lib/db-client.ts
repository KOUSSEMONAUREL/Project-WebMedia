import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { queryGetTrending, queryGetByType, queryGetDetails, querySearch, toMedia } from './db';
import type { Media } from '../types';

let _db: SqlJsDatabase | null = null;
let _ready: Promise<void> | null = null;

async function init(): Promise<void> {
  if (_db) return;
  if (_ready) return _ready;

  _ready = (async () => {
    const SQL = await initSqlJs({
      locateFile: (file: string) =>
        `https://unpkg.com/sql.js@1.11.0/dist/${file}`,
    });
    const resp = await fetch('/data/catalogue.sqlite');
    if (!resp.ok) throw new Error(`Failed to fetch catalogue: ${resp.status}`);
    const buf = await resp.arrayBuffer();
    _db = new SQL.Database(new Uint8Array(buf));
  })();

  return _ready;
}

type Row = Record<string, any>;

const dbAdapter = {
  async query(sql: string, params?: any[]): Promise<Row[]> {
    await init();
    if (!_db) throw new Error('DB not initialized');
    const stmt = _db.prepare(sql);
    if (params) stmt.bind(params);
    const rows: Row[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as Row);
    }
    stmt.free();
    return rows;
  },
};

export async function getTrending(): Promise<Media[]> {
  const rows = await queryGetTrending(dbAdapter);
  return rows.map(r => toMedia(r));
}

export async function getByType(type: string): Promise<Media[]> {
  const rows = await queryGetByType(dbAdapter, type);
  return rows.map(r => toMedia(r));
}

export async function getDetails(type: string, slug: string): Promise<Media> {
  const { media, episodes, links } = await queryGetDetails(dbAdapter, type, slug);
  if (!media) throw new Error('Média non trouvé');
  return toMedia(media, episodes, links);
}

export async function searchMedia(
  q: string,
  filters?: { type?: string; year?: number }
): Promise<Media[]> {
  const { data } = await querySearch(dbAdapter, q, filters?.type, filters?.year);
  return data.map(r => toMedia(r));
}
