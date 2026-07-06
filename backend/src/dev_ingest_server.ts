import http from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://test:test@127.0.0.1:5432/test'
const sql = postgres(DATABASE_URL)

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS dev_ingest_links (
      id bigserial PRIMARY KEY,
      media_id varchar(100),
      url text,
      source_site varchar(200),
      payload jsonb,
      scraped_at timestamptz DEFAULT now(),
      created_at timestamptz DEFAULT now()
    )
  `
}

async function handleIngest(body: any) {
  const mediaId = body.mediaId || null
  const links = body.links || []
  await ensureTable()

  for (const l of links) {
    const url = l.url || l.final_url || null
    const source = l.source_site || l.source || null
    const scrapedAt = l.scraped_at ? new Date(l.scraped_at * 1000) : null
    await sql`
      INSERT INTO dev_ingest_links (media_id, url, source_site, payload, scraped_at)
      VALUES (${mediaId}, ${url}, ${source}, ${sql.json(l)}, ${scrapedAt})
    `
  }

  return { status: 'ok', inserted: links.length }
}

const port = Number(process.env.PORT || 9000)

if (import.meta.main) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/ingest/liens') {
      try {
        let body = ''
        for await (const chunk of req) body += chunk.toString()
        // dump received body for debugging
        const tmpDir = mkdtempSync(join(tmpdir(), 'webmedia-ingest-'))
        try { writeFileSync(join(tmpDir, 'last_ingest_body.txt'), body) } catch (e) {}
        const data = JSON.parse(body || '{}')
        const result = await handleIngest(data)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (e) {
        console.error('ingest error', e)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'error', message: String(e) }))
      }
      return
    }

    res.writeHead(404)
    res.end('not found')
  })

  server.listen(port, () => {
    console.log(`dev ingest server listening on http://127.0.0.1:${port}`)
  })
}

export { handleIngest }
