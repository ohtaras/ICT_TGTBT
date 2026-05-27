import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { startWorker, getWorkerStatus } from './worker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trading_data (
      id         INTEGER PRIMARY KEY DEFAULT 1,
      signals    JSONB NOT NULL DEFAULT '[]',
      trades     JSONB NOT NULL DEFAULT '[]',
      pairs      JSONB NOT NULL DEFAULT '[]',
      settings   JSONB NOT NULL DEFAULT '{}',
      equity_history JSONB NOT NULL DEFAULT '[]',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    INSERT INTO trading_data (id) VALUES (1) ON CONFLICT DO NOTHING;
  `);
  console.log('[db] trading_data table ready');
}

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Public read-only status endpoint — no auth required
app.get('/api/status', async (_req: Request, res: Response) => {
  if (!process.env.DATABASE_URL) {
    res.json({ ok: true, db: false, message: 'No database — data lives in browser localStorage' });
    return;
  }
  try {
    const result = await pool.query('SELECT signals, trades, pairs, settings, equity_history, updated_at FROM trading_data WHERE id = 1');
    const row = result.rows[0];
    if (!row) { res.json({ ok: true, db: true, data: null }); return; }

    const signals = row.signals ?? [];
    const trades  = row.trades  ?? [];
    const pairs   = row.pairs   ?? [];

    const openTrades   = trades.filter((t: { status: string }) => t.status === 'open');
    const closedTrades = trades.filter((t: { status: string }) => t.status === 'won' || t.status === 'lost');
    const wonTrades    = trades.filter((t: { status: string }) => t.status === 'won');
    const pendingSignals = signals.filter((s: { status: string }) => s.status === 'pending');

    res.json({
      ok: true,
      db: true,
      updatedAt: row.updated_at,
      summary: {
        totalSignals:   signals.length,
        pendingSignals: pendingSignals.length,
        openTrades:     openTrades.length,
        closedTrades:   closedTrades.length,
        winRate:        closedTrades.length > 0 ? `${((wonTrades.length / closedTrades.length) * 100).toFixed(1)}%` : 'N/A',
        activePairs:    (pairs as { enabled: boolean }[]).filter(p => p.enabled).length,
        autoTrading:    (row.settings as { autoTrading?: boolean })?.autoTrading ?? false,
        balance:        (row.settings as { initialBalance?: number })?.initialBalance ?? 0,
      },
      openTrades,
      pendingSignals,
      pairs,
    });
  } catch (err) {
    console.error('[status] error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Public worker status — shows last price check and ICT scan timestamps
app.get('/api/worker-status', (_req: Request, res: Response) => {
  res.json(getWorkerStatus());
});

// Diagnostic: test Binance connectivity from the server side
app.get('/api/debug-worker', async (_req: Request, res: Response) => {
  const results: Record<string, unknown> = {};
  const BINANCE = 'https://api.binance.com';
  const endpoints = [
    { key: 'ping',         url: `${BINANCE}/api/v3/ping` },
    { key: 'ticker_price', url: `${BINANCE}/api/v3/ticker/price?symbol=BTCUSDT` },
    { key: 'ticker_24hr',  url: `${BINANCE}/api/v3/ticker/24hr?symbol=BTCUSDT` },
    { key: 'klines',       url: `${BINANCE}/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1` },
  ];
  for (const { key, url } of endpoints) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      results[key] = { ok: r.ok, status: r.status };
      if (r.ok && key === 'ticker_price') {
        const d = await r.json() as { price: string };
        results[key] = { ok: true, price: d.price };
      }
    } catch (err) {
      results[key] = { ok: false, error: String(err) };
    }
  }
  results['workerStatus'] = getWorkerStatus();
  res.json(results);
});

// Optional API key auth — set API_KEY env var on Railway to enable
const API_KEY = process.env.API_KEY;
if (API_KEY) {
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (req.headers['x-api-key'] !== API_KEY) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  });
}

app.get('/api/data', async (_req: Request, res: Response) => {
  if (!process.env.DATABASE_URL) {
    res.status(503).json({ error: 'No database configured' });
    return;
  }
  try {
    const result = await pool.query('SELECT * FROM trading_data WHERE id = 1');
    const row = result.rows[0];
    if (!row) { res.json({}); return; }
    res.json({
      signals:       row.signals,
      trades:        row.trades,
      pairs:         row.pairs,
      settings:      row.settings,
      equityHistory: row.equity_history,
      updatedAt:     row.updated_at,
    });
  } catch (err) {
    console.error('[db] GET error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/data', async (req: Request, res: Response) => {
  if (!process.env.DATABASE_URL) {
    res.status(503).json({ error: 'No database configured' });
    return;
  }
  try {
    const { signals, trades, pairs, settings, equityHistory } = req.body;
    const result = await pool.query(
      `UPDATE trading_data
       SET signals=$1, trades=$2, pairs=$3, settings=$4, equity_history=$5, updated_at=NOW()
       WHERE id=1
       RETURNING updated_at`,
      [
        JSON.stringify(signals        ?? []),
        JSON.stringify(trades         ?? []),
        JSON.stringify(pairs          ?? []),
        JSON.stringify(settings       ?? {}),
        JSON.stringify(equityHistory  ?? []),
      ]
    );
    res.json({ ok: true, updatedAt: result.rows[0]?.updated_at });
  } catch (err) {
    console.error('[db] POST error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Delete all server data (danger zone)
app.delete('/api/data', async (_req: Request, res: Response) => {
  if (!process.env.DATABASE_URL) {
    res.status(503).json({ error: 'No database configured' });
    return;
  }
  try {
    await pool.query(
      `UPDATE trading_data
       SET signals='[]', trades='[]', settings='{"autoTrading":false,"riskPerTrade":2,"initialBalance":10000,"leverage":10,"feeRate":0.04,"fundingRate":0.01}', equity_history='[]', updated_at=NOW()
       WHERE id=1`
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[db] DELETE error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Patch a specific trade (e.g. manual close)
app.patch('/api/trades/:id', async (req: Request, res: Response) => {
  if (!process.env.DATABASE_URL) { res.status(503).json({ error: 'No database configured' }); return; }
  try {
    const { id } = req.params;
    const patch = JSON.stringify(req.body);
    await pool.query(`
      UPDATE trading_data
      SET trades = (
        SELECT COALESCE(jsonb_agg(
          CASE WHEN t->>'id' = $1 THEN t || $2::jsonb ELSE t END
        ), '[]'::jsonb)
        FROM jsonb_array_elements(trades) t
      ), updated_at = NOW()
      WHERE id = 1
    `, [id, patch]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[db] PATCH trade error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Delete a specific trade
app.delete('/api/trades/:id', async (req: Request, res: Response) => {
  if (!process.env.DATABASE_URL) { res.status(503).json({ error: 'No database configured' }); return; }
  try {
    const { id } = req.params;
    await pool.query(`
      UPDATE trading_data
      SET trades = (
        SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
        FROM jsonb_array_elements(trades) t
        WHERE t->>'id' != $1
      ), updated_at = NOW()
      WHERE id = 1
    `, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[db] DELETE trade error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Delete a specific signal
app.delete('/api/signals/:id', async (req: Request, res: Response) => {
  if (!process.env.DATABASE_URL) { res.status(503).json({ error: 'No database configured' }); return; }
  try {
    const { id } = req.params;
    await pool.query(`
      UPDATE trading_data
      SET signals = (
        SELECT COALESCE(jsonb_agg(s), '[]'::jsonb)
        FROM jsonb_array_elements(signals) s
        WHERE s->>'id' != $1
      ), updated_at = NOW()
      WHERE id = 1
    `, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[db] DELETE signal error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Update settings only
app.put('/api/settings', async (req: Request, res: Response) => {
  if (!process.env.DATABASE_URL) { res.status(503).json({ error: 'No database configured' }); return; }
  try {
    await pool.query(
      'UPDATE trading_data SET settings=$1, updated_at=NOW() WHERE id=1',
      [JSON.stringify(req.body)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[db] PUT settings error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Update pairs only
app.put('/api/pairs', async (req: Request, res: Response) => {
  if (!process.env.DATABASE_URL) { res.status(503).json({ error: 'No database configured' }); return; }
  try {
    await pool.query(
      'UPDATE trading_data SET pairs=$1, updated_at=NOW() WHERE id=1',
      [JSON.stringify(req.body)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[db] PUT pairs error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Serve Vite build
const staticDir = path.join(__dirname, '../dist');
app.use(express.static(staticDir));
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

async function start() {
  if (process.env.DATABASE_URL) {
    await initDb();
    startWorker(pool);
  } else {
    console.warn('[db] DATABASE_URL not set — worker disabled, data lives in browser only');
  }
  const port = parseInt(process.env.PORT || '3000', 10);
  app.listen(port, () => {
    console.log(`ICT Terminal listening on port ${port}`);
  });
}

start().catch((err) => {
  console.error('Startup error:', err);
  process.exit(1);
});
