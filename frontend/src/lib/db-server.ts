import Database from 'better-sqlite3';
import { queryGetTrending, queryGetByType, queryGetDetails, querySearch, toMedia, type DbMedia } from './db';
import type { Media } from '../types';
import { resolve } from 'path';

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    const dbPath = resolve(process.cwd(), 'public/data/catalogue.sqlite');
    _db = new Database(dbPath, { readonly: true });
    _db.pragma('cache_size = -8000');
    _db.pragma('mmap_size = 268435456');
  }
  return _db;
}

interface StatementCache {
  [key: string]: Database.Statement;
}

const _stmt: StatementCache = {};

function prepare(sql: string): Database.Statement {
  if (!_stmt[sql]) {
    _stmt[sql] = getDb().prepare(sql);
  }
  return _stmt[sql];
}

type Row = Record<string, any>;

const dbAdapter = {
  async query(sql: string, params?: any[]): Promise<Row[]> {
    if (params) {
      const stmt = prepare(sql);
      const rows = params ? stmt.all(...params) : stmt.all();
      return rows as Row[];
    }
    const stmt = prepare(sql);
    return stmt.all() as Row[];
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
