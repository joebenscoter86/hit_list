import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// State (SQLite DB, server logs, the port/PID file) lives here, outside the repo.
const STATE_DIR = path.join(HOME, '.hit-list');
fs.mkdirSync(STATE_DIR, { recursive: true });

// Resolve the config file. Precedence:
//   1. HIT_LIST_CONFIG env var (absolute path)
//   2. ~/.hit-list/config.json
//   3. <repo root>/config.json
// Copy config.example.json to one of these and fill it in. See README.md.
function resolveConfigPath() {
  const candidates = [
    process.env.HIT_LIST_CONFIG,
    path.join(STATE_DIR, 'config.json'),
    path.join(REPO_ROOT, 'config.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadUserConfig() {
  const p = resolveConfigPath();
  if (!p) {
    throw new Error(
      'No config.json found. Copy config.example.json to config.json ' +
      '(in the repo root or ~/.hit-list/) and fill it in. See README.md.'
    );
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`Failed to parse config at ${p}: ${e.message}`);
  }
}

const user = loadUserConfig();

// Secrets can live in config.json OR in environment variables. Env wins so you
// can keep tokens out of any file (e.g. inject them from a service manager).
const guidecxToken = process.env.GUIDECX_TOKEN || user.guidecx?.token || null;
const fathomKey = process.env.FATHOM_API_KEY || user.fathom?.apiKey || null;

export const config = {
  // Where state lives
  stateDir: STATE_DIR,
  dbPath: path.join(STATE_DIR, 'todo.db'),
  statePath: path.join(STATE_DIR, 'state.json'),
  logPath: path.join(STATE_DIR, 'server.log'),

  // Server
  defaultPort: user.port || 3847,
  productName: user.productName || 'Hit List',

  // Who you are
  userName: user.userName || 'you',
  userEmail: user.userEmail || '',
  userSlackId: user.userSlackId || '',
  orgDomain: (user.orgDomain || '').toLowerCase(),

  // Behavior
  timezone: user.timezone || 'America/New_York',
  workHoursPerDay: user.workHoursPerDay ?? 8,
  activeProjects: Array.isArray(user.activeProjects) ? user.activeProjects : [],
  excludeKeywords: Array.isArray(user.excludeKeywords) ? user.excludeKeywords : [],

  // Headless-Claude pull (Slack / Gmail / Calendar via your claude.ai connectors)
  claudeBin: process.env.CLAUDE_BIN || user.claudeBin || 'claude',
  claudePullEnabled: user.claudePull?.enabled !== false,
  slackWorkspaceUrl: (user.slack?.workspaceUrl || '').replace(/\/$/, ''),

  // GuideCX (optional native source)
  guidecx: {
    enabled: user.guidecx?.enabled !== false && !!guidecxToken,
    apiBase: (user.guidecx?.apiBase || 'https://api.guidecx.com/api/v2').replace(/\/$/, ''),
    webBaseUrl: (user.guidecx?.webBaseUrl || '').replace(/\/$/, ''),
    token: guidecxToken,
  },

  // Fathom (optional native source)
  fathom: {
    enabled: user.fathom?.enabled !== false && !!fathomKey,
    apiBase: (user.fathom?.apiBase || 'https://api.fathom.ai/external/v1').replace(/\/$/, ''),
    apiKey: fathomKey,
  },
};
