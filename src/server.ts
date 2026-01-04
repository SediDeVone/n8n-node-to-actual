import express, { Request, Response, NextFunction } from 'express';

// Import @actual-app/api in a way that tolerates type changes across versions
// eslint-disable-next-line @typescript-eslint/no-var-requires
const actual: any = require('@actual-app/api');

const PORT = process.env.PORT ? Number(process.env.PORT) : 7006;

// Normalize the server URL - remove trailing /api or /api/ if present
// The @actual-app/api library expects the base URL and appends paths like /account/login internally
function normalizeServerUrl(url: string): string {
  if (!url) return url;
  // Remove trailing slash first
  let normalized = url.replace(/\/+$/, '');
  // Remove /api suffix if present (case-insensitive)
  normalized = normalized.replace(/\/api$/i, '');
  return normalized;
}

const ACTUAL_SERVER_URL = normalizeServerUrl(process.env.ACTUAL_SERVER_URL || 'https://actual.slasisz.com');
const ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD || '';
const DEBUG_ACTUAL = String(process.env.DEBUG_ACTUAL || '').toLowerCase() === '1' ||
  String(process.env.DEBUG_ACTUAL || '').toLowerCase() === 'true';

// Try to read version of @actual-app/api for diagnostics
let ACTUAL_API_VERSION = 'unknown';
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ACTUAL_API_VERSION = require('@actual-app/api/package.json')?.version || ACTUAL_API_VERSION;
} catch {}

function dlog(...args: any[]) {
  if (DEBUG_ACTUAL) {
    // eslint-disable-next-line no-console
    console.log('[DEBUG_ACTUAL]', ...args);
  }
}

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    if (u.username) u.username = '***';
    return u.toString();
  } catch {
    return url;
  }
}

let initialized = false;

async function ensureInit() {
  if (initialized) return;
  if (!ACTUAL_SERVER_URL || !ACTUAL_PASSWORD) {
    // Defer hard failure until a route actually needs Actual
    throw Object.assign(new Error('Actual not configured: set ACTUAL_SERVER_URL and ACTUAL_PASSWORD'), {
      status: 500,
    });
  }
  if (!actual || typeof actual.init !== 'function') {
    throw Object.assign(new Error('Invalid @actual-app/api: missing init()'), { status: 500 });
  }
  dlog('Initializing Actual API...', {
    serverURL: redactUrl(ACTUAL_SERVER_URL),
    passwordLen: ACTUAL_PASSWORD ? ACTUAL_PASSWORD.length : 0,
    node: process.version,
    actualApiVersion: ACTUAL_API_VERSION,
  });
  
  // Initialize without password first - the library's init() silently ignores sign-in errors
  await actual.init({ serverURL: ACTUAL_SERVER_URL });
  
  // Manually sign in and check the result
  // The internal.send method allows us to call handlers directly and get the result
  if (actual.internal && typeof actual.internal.send === 'function') {
    dlog('Attempting manual sign-in via internal.send...');
    const signInResult = await actual.internal.send('subscribe-sign-in', { password: ACTUAL_PASSWORD });
    dlog('Sign-in result:', signInResult);
    if (signInResult && signInResult.error) {
      throw Object.assign(new Error(`Authentication failed: ${signInResult.error}`), { status: 401 });
    }
  } else {
    // Fallback: try re-init with password (may silently fail)
    dlog('internal.send not available, using standard init with password');
    await actual.shutdown?.();
    await actual.init({ serverURL: ACTUAL_SERVER_URL, password: ACTUAL_PASSWORD });
  }
  
  dlog('Initialized. Available methods:', {
    downloadBudgets: typeof actual.downloadBudgets === 'function',
    getBudgets: typeof actual.getBudgets === 'function',
    listBudgets: typeof actual.listBudgets === 'function',
    runWithBudget: typeof actual.runWithBudget === 'function',
    openBudget: typeof actual.openBudget === 'function',
    loadBudget: typeof actual.loadBudget === 'function',
    downloadBudget: typeof actual.downloadBudget === 'function',
    getAccounts: typeof actual.getAccounts === 'function',
    addTransactions: typeof actual.addTransactions === 'function',
  });
  initialized = true;
}

async function shutdownActual() {
  try {
    if (actual && typeof actual.shutdown === 'function') {
      await actual.shutdown();
    }
  } catch {
    // ignore
  } finally {
    initialized = false;
  }
}

async function listBudgets(): Promise<Array<{ id: string; name: string }>> {
  await ensureInit();
  const tried: Record<string, any> = {};
  if (typeof actual.downloadBudgets === 'function') {
    try {
      const res = await actual.downloadBudgets();
      dlog('downloadBudgets() returned', Array.isArray(res) ? res.length : 'non-array');
      return res;
    } catch (e: any) {
      tried.downloadBudgets = e?.message || String(e);
      dlog('downloadBudgets() error', tried.downloadBudgets);
    }
  }
  if (typeof actual.getBudgets === 'function') {
    try {
      const res = await actual.getBudgets();
      dlog('getBudgets() returned', Array.isArray(res) ? res.length : 'non-array');
      return res;
    } catch (e: any) {
      tried.getBudgets = e?.message || String(e);
      dlog('getBudgets() error', tried.getBudgets);
    }
  }
  if (typeof actual.listBudgets === 'function') {
    try {
      const res = await actual.listBudgets();
      dlog('listBudgets() returned', Array.isArray(res) ? res.length : 'non-array');
      return res;
    } catch (e: any) {
      tried.listBudgets = e?.message || String(e);
      dlog('listBudgets() error', tried.listBudgets);
    }
  }
  dlog('No supported method to list budgets (errors):', tried);
  throw Object.assign(new Error('No supported method to list budgets'), { status: 500 });
}

async function withBudget<T>(budgetId: string, fn: () => Promise<T>): Promise<T> {
  await ensureInit();
  
  // The budgetId from getBudgets() is actually the syncId (remote file ID).
  // We need to download the budget from the remote server first, which creates
  // a local copy, then load it. The downloadBudget function handles this.
  if (typeof actual.downloadBudget === 'function') {
    dlog('Downloading budget from remote server:', budgetId);
    await actual.downloadBudget(budgetId);
    dlog('Budget downloaded successfully');
    try {
      return await fn();
    } finally {
      // Budget will be closed on shutdown
    }
  }
  
  // Fallback methods for local budgets or older API versions
  if (typeof actual.runWithBudget === 'function') {
    return actual.runWithBudget(budgetId, fn);
  }
  if (typeof actual.openBudget === 'function') {
    await actual.openBudget(budgetId);
    try {
      return await fn();
    } finally {
      // closed on shutdown
    }
  }
  if (typeof actual.loadBudget === 'function') {
    await actual.loadBudget(budgetId);
    try {
      return await fn();
    } finally {
      // noop
    }
  }
  throw Object.assign(new Error('No supported method to select budget'), { status: 500 });
}

function toMilliunits(amount: unknown): number {
  if (typeof amount === 'number') return Math.round(amount * 1000);
  if (typeof amount === 'string') return Math.round(parseFloat(amount) * 1000);
  throw Object.assign(new Error('Amount must be a number or numeric string'), { status: 400 });
}

const app = express();
app.use(express.json());

// Basic health endpoint that does not require Actual to be configured
app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// GET /budgets → list budgets
app.get('/budgets', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const budgets = await listBudgets();
    dlog('Responding /budgets with', Array.isArray(budgets) ? budgets.length : 'non-array');
    res.json({ budgets });
  } catch (err) {
    next(err);
  }
});

// GET /budgets/:budgetId/accounts → list accounts for budget
app.get('/budgets/:budgetId/accounts', async (req: Request, res: Response, next: NextFunction) => {
  const { budgetId } = req.params;
  try {
    if (!budgetId) return res.status(400).json({ error: 'budgetId is required' });
    const accounts = await withBudget(budgetId, async () => {
      if (typeof actual.getAccounts === 'function') {
        const list = await actual.getAccounts();
        const mapped = (list || []).map((a: any) => ({ id: a.id || a.uuid || a.account_id, name: a.name }));
        dlog('getAccounts() returned', mapped.length);
        return mapped;
      }
      const maybe = actual?.state?.accounts || [];
      const mapped = maybe.map((a: any) => ({ id: a.id, name: a.name }));
      dlog('state.accounts fallback returned', mapped.length);
      return mapped;
    });
    res.json({ accounts });
  } catch (err) {
    next(err);
  }
});

// POST /budgets/:budgetId/transactions → create transactions
app.post('/budgets/:budgetId/transactions', async (req: Request, res: Response, next: NextFunction) => {
  const { budgetId } = req.params;
  const { transactions } = req.body || {};
  try {
    if (!budgetId) return res.status(400).json({ error: 'budgetId is required' });
    if (!Array.isArray(transactions)) {
      return res.status(400).json({ error: 'Body must include array `transactions`' });
    }

    const created = await withBudget(budgetId, async () => {
      // Use importTransactions for deduplication support (it uses reconcileTransactions internally)
      // Fall back to addTransactions if importTransactions is not available
      const useImport = typeof actual.importTransactions === 'function';
      if (!useImport && typeof actual.addTransactions !== 'function') {
        throw Object.assign(new Error('Neither importTransactions nor addTransactions available on @actual-app/api'), { status: 500 });
      }

      // Group transactions by account ID since both methods require accountId as first param
      const byAccount: Record<string, any[]> = {};
      for (const tx of transactions) {
        const accountId = tx.account;
        if (!accountId) {
          throw Object.assign(new Error('Each transaction must have an "account" field'), { status: 400 });
        }
        if (!byAccount[accountId]) {
          byAccount[accountId] = [];
        }

        // Build a clean transaction object with only valid fields for Actual Budget API
        // Map transaction_id to imported_id for deduplication support
        const cleanTx: any = {
          date: tx.date,
          amount: toMilliunits(tx.amount),
        };
        if (tx.payee_name) cleanTx.payee_name = tx.payee_name;
        if (tx.payee) cleanTx.payee_name = tx.payee;
        if (tx.notes) cleanTx.notes = tx.notes;
        if (tx.category) cleanTx.category = tx.category;
        if (tx.transaction_id != null) cleanTx.imported_id = String(tx.transaction_id);
        if (tx.imported_id != null) cleanTx.imported_id = String(tx.imported_id);

        byAccount[accountId].push(cleanTx);
      }

      const allResults: any[] = [];
      for (const [accountId, txs] of Object.entries(byAccount)) {
        if (useImport) {
          // importTransactions handles deduplication via imported_id
          dlog('importTransactions() sending', txs.length, 'transactions to account', accountId);
          const resp = await actual.importTransactions(accountId, txs);
          dlog('importTransactions() response', resp);
          // importTransactions returns { added, updated } or similar structure
          if (resp) {
            allResults.push(resp);
          }
        } else {
          // Fallback to addTransactions (no deduplication)
          dlog('addTransactions() sending', txs.length, 'transactions to account', accountId);
          const resp = await actual.addTransactions(accountId, txs);
          dlog('addTransactions() response', Array.isArray(resp) ? resp.length : typeof resp);
          if (Array.isArray(resp)) {
            allResults.push(...resp);
          } else if (resp) {
            allResults.push(resp);
          }
        }
      }
      return allResults;
    });

    res.status(201).json({ result: created });
  } catch (err) {
    next(err);
  }
});

// Error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err?.status || 500;
  const message = err?.message || 'Internal Server Error';
  if (DEBUG_ACTUAL) {
    // eslint-disable-next-line no-console
    console.error('[DEBUG_ACTUAL] Error:', message, err?.stack || err);
  }
  res.status(status).json({ error: message });
});

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Actual REST wrapper listening on http://0.0.0.0:${PORT}`);
  dlog('Runtime info:', {
    serverURL: redactUrl(ACTUAL_SERVER_URL),
    passwordLen: ACTUAL_PASSWORD ? ACTUAL_PASSWORD.length : 0,
    node: process.version,
    actualApiVersion: ACTUAL_API_VERSION,
  });
});

const shutdown = async () => {
  // eslint-disable-next-line no-console
  console.log('Shutting down...');
  server.close(() => {
    // eslint-disable-next-line no-console
    console.log('HTTP server closed');
  });
  await shutdownActual();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Optional debug endpoint to inspect configuration and probe methods
if (DEBUG_ACTUAL) {
  app.get('/debug/info', async (_req: Request, res: Response) => {
    const info: any = {
      initialized,
      serverURL: redactUrl(ACTUAL_SERVER_URL),
      passwordLen: ACTUAL_PASSWORD ? ACTUAL_PASSWORD.length : 0,
      node: process.version,
      actualApiVersion: ACTUAL_API_VERSION,
      methods: {
        downloadBudgets: typeof actual.downloadBudgets === 'function',
        getBudgets: typeof actual.getBudgets === 'function',
        listBudgets: typeof actual.listBudgets === 'function',
        runWithBudget: typeof actual.runWithBudget === 'function',
        openBudget: typeof actual.openBudget === 'function',
        loadBudget: typeof actual.loadBudget === 'function',
        downloadBudget: typeof actual.downloadBudget === 'function',
        getAccounts: typeof actual.getAccounts === 'function',
        addTransactions: typeof actual.addTransactions === 'function',
      },
    };
    try {
      await ensureInit();
      const counts: Record<string, any> = {};
      if (typeof actual.downloadBudgets === 'function') {
        try { counts.downloadBudgets = (await actual.downloadBudgets())?.length ?? null; } catch (e: any) { counts.downloadBudgets = `ERR: ${e?.message || String(e)}`; }
      }
      if (typeof actual.getBudgets === 'function') {
        try { counts.getBudgets = (await actual.getBudgets())?.length ?? null; } catch (e: any) { counts.getBudgets = `ERR: ${e?.message || String(e)}`; }
      }
      if (typeof actual.listBudgets === 'function') {
        try { counts.listBudgets = (await actual.listBudgets())?.length ?? null; } catch (e: any) { counts.listBudgets = `ERR: ${e?.message || String(e)}`; }
      }
      info.probe = counts;
    } catch (e: any) {
      info.initError = e?.message || String(e);
    }
    res.json(info);
  });
}
