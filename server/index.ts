import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

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
       SET signals='[]', trades='[]', pairs='[]', settings='{}', equity_history='[]', updated_at=NOW()
       WHERE id=1`
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[db] DELETE error:', err);
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
  } else {
    console.warn('[db] DATABASE_URL not set — persistence disabled');
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
