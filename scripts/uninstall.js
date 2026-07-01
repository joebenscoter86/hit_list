#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.hitlist.server.plist');
try { execSync(`launchctl unload "${PLIST_PATH}"`); } catch {}
if (fs.existsSync(PLIST_PATH)) { fs.unlinkSync(PLIST_PATH); console.log('Removed plist.'); }
console.log('Uninstalled.');
