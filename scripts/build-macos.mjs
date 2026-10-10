import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

if (process.platform !== 'darwin') {
  console.error('Mac installers must be built on macOS.');
  process.exit(1);
}

const configuredUrl = process.env.LICENSE_SERVER_URL;
if (!configuredUrl) {
  console.error('Set LICENSE_SERVER_URL to the HTTPS root address of your license service before building.');
  process.exit(1);
}

let licenseUrl;
try {
  licenseUrl = new URL(configuredUrl);
  if (licenseUrl.protocol !== 'https:' || licenseUrl.username || licenseUrl.password ||
      licenseUrl.search || licenseUrl.hash || licenseUrl.pathname !== '/') {
    throw new Error('Expected an HTTPS root URL without credentials, path, query or fragment.');
  }
} catch (error) {
  console.error(`Invalid LICENSE_SERVER_URL: ${error.message}`);
  process.exit(1);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const csp = config.app.security.csp;
const mergedCsp = csp.replace(/connect-src\s+([^;]+)/, (_, sources) => {
  return `connect-src ${[...new Set([...sources.trim().split(/\s+/), licenseUrl.origin])].join(' ')}`;
});

if (!mergedCsp.includes(licenseUrl.origin)) {
  console.error('The application CSP must define connect-src.');
  process.exit(1);
}

const target = process.env.MAC_BUILD_TARGET || 'universal-apple-darwin';
if (!['universal-apple-darwin', 'aarch64-apple-darwin', 'x86_64-apple-darwin'].includes(target)) {
  console.error('MAC_BUILD_TARGET must be a macOS Rust target or universal-apple-darwin.');
  process.exit(1);
}

const result = spawnSync(process.execPath, [
  path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'),
  'build', '--target', target, '--bundles', 'app,dmg',
  '--config', JSON.stringify({ app: { security: { csp: mergedCsp } } }),
  ...process.argv.slice(2),
], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, LICENSE_SERVER_URL: licenseUrl.origin },
});

if (result.error) {
  console.error(result.error.message);
}
process.exit(result.status ?? 1);
