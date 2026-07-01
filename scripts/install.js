#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..');
const NODE_BIN = process.execPath;
const SERVER_JS = path.join(APP_DIR, 'src', 'server.js');
const PLIST_PATH = path.join(HOME, 'Library', 'LaunchAgents', 'com.hitlist.server.plist');
const STATE_DIR = path.join(HOME, '.hit-list');

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.hitlist.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${SERVER_JS}</string>
  </array>
  <key>WorkingDirectory</key><string>${APP_DIR}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${STATE_DIR}/server.log</string>
  <key>StandardErrorPath</key><string>${STATE_DIR}/server.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
</dict>
</plist>
`;

fs.mkdirSync(STATE_DIR, { recursive: true });
fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
fs.writeFileSync(PLIST_PATH, plist);
console.log(`Wrote plist to ${PLIST_PATH}`);

try { execSync(`launchctl unload "${PLIST_PATH}"`, { stdio: 'pipe' }); } catch {}
execSync(`launchctl load "${PLIST_PATH}"`);
console.log('Loaded launchd agent.');

// Wait a sec, then verify
await new Promise(r => setTimeout(r, 1500));
const statePath = path.join(STATE_DIR, 'state.json');
if (fs.existsSync(statePath)) {
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  console.log(`Server is up on http://localhost:${state.port} (pid ${state.pid})`);
} else {
  console.error('Server did not write state.json. Check ~/.hit-list/server.log');
  process.exit(1);
}
