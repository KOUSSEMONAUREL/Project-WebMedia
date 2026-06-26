import fs from 'fs';
import path from 'path';
import { BaseScraper } from '../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../engine/types';

const SCRAPERS_DIR = path.join(__dirname, '..', '..', '..', '..', 'scrapers', 'webtoons', 'definitions', 'webtoons');

export interface ScraperInfo {
  name: string;
  className: string;
  filePath: string;
  lang: string;
}

function findScraperFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findScraperFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

export function listScrapers(): ScraperInfo[] {
  const files = findScraperFiles(SCRAPERS_DIR);
  const infos: ScraperInfo[] = [];
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const classMatch = content.match(/export\s+class\s+(\w+)\s+extends\s+(\w+)/);
    const nameMatch = content.match(/readonly\s+name\s*=\s*'([^']+)'/);
    const langMatch = content.match(/readonly\s+lang\s*=\s*'([^']+)'/);
    if (classMatch) {
      infos.push({
        name: nameMatch?.[1] || classMatch[1],
        className: classMatch[1],
        filePath,
        lang: langMatch?.[1] || 'unknown',
      });
    }
  }
  return infos;
}

export async function getScraper(nameOrUrl: string): Promise<BaseScraper | null> {
  const scrapers = listScrapers();
  const match = nameOrUrl.toLowerCase();

  for (const info of scrapers) {
    if (info.name.toLowerCase() === match || info.className.toLowerCase().replace(/scraper$/, '') === match) {
      const mod = await import(info.filePath);
      const ScraperClass = mod[info.className] || mod.default;
      if (ScraperClass) return new ScraperClass();
    }
  }
  return null;
}

export async function getScraperForUrl(url: string): Promise<BaseScraper | null> {
  const scrapers = listScrapers();
  const urlLower = url.toLowerCase();

  for (const info of scrapers) {
    const content = fs.readFileSync(info.filePath, 'utf-8');
    const baseUrlMatch = content.match(/readonly\s+baseUrl\s*=\s*'([^']+)'/);
    if (baseUrlMatch && urlLower.includes(baseUrlMatch[1].toLowerCase().replace(/https?:\/\//, ''))) {
      const mod = await import(info.filePath);
      const ScraperClass = mod[info.className] || mod.default;
      if (ScraperClass) return new ScraperClass();
    }
  }
  return null;
}
