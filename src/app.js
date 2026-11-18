import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

// v1 of the short-link service.

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const newCode = () => [...randomBytes(8)].map((b) => ALPHABET[b % ALPHABET.length]).join('');

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return null; }
}

const isUrl = (u) => typeof u === 'string' && /^https?:\/\/\S+$/.test(u);
const isPositiveSeconds = (value) => Number.isInteger(value) && value > 0;

export function createApp(db, config) {
  const columns = new Set(db.prepare('PRAGMA table_info(links)').all().map((column) => column.name));
  const hasExpirySchema = columns.has('expires_at');
  const hasFlagsTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'feature_flags'").get();

  const expiryEnabled = () => hasFlagsTable && Boolean(
    db.prepare("SELECT enabled FROM feature_flags WHERE name = 'expiry'").get()?.enabled,
  );
  const expiresColumn = hasExpirySchema ? 'expires_at' : 'NULL AS expires_at';

  const view = (row) => ({
    code: row.code,
    url: row.url,
    shortUrl: `${config.baseUrl}/r/${row.code}`,
    hits: row.hits,
    expiresAt: expiryEnabled() ? row.expires_at : null,
  });

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const error = (res, status, code, message) => json(res, status, { error: code, message });

  async function handle(req, res) {
    res.setHeader('x-app-version', config.version);
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);

    if (req.method === 'GET' && url.pathname === '/health') {
      db.prepare('SELECT 1').get();
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/version') {
      return json(res, 200, {
        version: config.version,
        env: config.env,
        flags: { expiry: expiryEnabled() },
      });
    }
    // tools/check.js uses this to hold a request open during `docker stop`. Leave it in.
    if (req.method === 'GET' && url.pathname === '/__probe/slow') {
      const ms = Math.min(Number(url.searchParams.get('ms') ?? 1000), 5000);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"waited":');
      await new Promise((r) => setTimeout(r, ms));
      return res.end(`${ms}}`);
    }

    if (parts[0] === 'links' && parts.length === 1) {
      if (req.method === 'GET') {
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 100);
        const offset = Number(url.searchParams.get('offset') ?? 0);
        return json(res, 200, db.prepare(`SELECT code, url, hits, ${expiresColumn} FROM links ORDER BY id DESC LIMIT ? OFFSET ?`).all(limit, offset).map(view));
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (!body || !isUrl(body.url)) return error(res, 400, 'invalid_body', 'url (http or https) is required');
        const enabled = expiryEnabled();
        let expiresAt = null;
        if (enabled && Object.hasOwn(body, 'expiresInSeconds')) {
          if (!isPositiveSeconds(body.expiresInSeconds)) {
            return error(res, 400, 'invalid_body', 'expiresInSeconds must be a positive integer');
          }
          const expires = new Date(Date.now() + body.expiresInSeconds * 1000);
          if (!Number.isFinite(expires.getTime())) {
            return error(res, 400, 'invalid_body', 'expiresInSeconds must be within the supported date range');
          }
          expiresAt = expires.toISOString();
        }
        const code = newCode();
        if (hasExpirySchema) {
          db.prepare('INSERT INTO links (code, url, expires_at) VALUES (?, ?, ?)').run(code, body.url, expiresAt);
        } else {
          db.prepare('INSERT INTO links (code, url) VALUES (?, ?)').run(code, body.url);
        }
        return json(res, 201, view(db.prepare(`SELECT code, url, hits, ${expiresColumn} FROM links WHERE code = ?`).get(code)));
      }
    }

    if (req.method === 'GET' && parts[0] === 'links' && parts.length === 2) {
      const row = db.prepare(`SELECT code, url, hits, ${expiresColumn} FROM links WHERE code = ?`).get(parts[1]);
      if (!row) return error(res, 404, 'not_found', `no link ${parts[1]}`);
      return json(res, 200, view(row));
    }

    if (req.method === 'GET' && parts[0] === 'r' && parts.length === 2) {
      if (expiryEnabled() && hasExpirySchema) {
        const row = db.prepare(`UPDATE links
          SET hits = hits + 1
          WHERE code = ? AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          RETURNING code, url, hits, expires_at`).get(parts[1]);
        if (row) {
          res.writeHead(302, { location: row.url });
          return res.end();
        }
        const exists = db.prepare('SELECT 1 FROM links WHERE code = ?').get(parts[1]);
        return exists ? error(res, 410, 'expired', 'link has expired') : error(res, 404, 'not_found', `no link ${parts[1]}`);
      }

      const row = db.prepare(`SELECT code, url, hits, ${expiresColumn} FROM links WHERE code = ?`).get(parts[1]);
      if (!row) return error(res, 404, 'not_found', `no link ${parts[1]}`);
      db.prepare('UPDATE links SET hits = hits + 1 WHERE code = ?').run(row.code);
      res.writeHead(302, { location: row.url });
      return res.end();
    }

    if (req.method === 'PUT' && url.pathname === '/admin/flags/expiry') {
      if (!config.adminToken || req.headers['x-admin-token'] !== config.adminToken) {
        return error(res, 401, 'unauthorized', 'invalid admin token');
      }
      const body = await readBody(req);
      if (!body || typeof body.enabled !== 'boolean') {
        return error(res, 400, 'invalid_body', 'enabled must be a boolean');
      }
      if (!hasFlagsTable) {
        return error(res, 500, 'internal', 'feature_flags table is missing');
      }
      db.prepare('UPDATE feature_flags SET enabled = ? WHERE name = ?').run(body.enabled ? 1 : 0, 'expiry');
      return json(res, 200, { expiry: Boolean(body.enabled) });
    }

    return error(res, 404, 'not_found', 'no such route');
  }

  return createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) error(res, 500, 'internal', e.message);
      else res.end();
    });
  });
}
