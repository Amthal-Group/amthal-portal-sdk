#!/usr/bin/env node
/**
 * Generate this example's `ios/` and `android/` projects.
 *
 * They are not committed on purpose: generated native projects go stale against every
 * React Native bump, and a stale one fails in ways that look like SDK bugs. This script
 * materialises them from the SAME React Native version the example depends on, so they
 * are always in step.
 *
 * It works by initialising a throwaway app from the official template in a temp
 * directory and moving its two native folders across — which is what the React Native
 * CLI itself does, and the only supported way to add native projects to a JS-only app.
 *
 * Usage: npm run prebuild [-- --force]
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync, renameSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');

const appName = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).name;
const rnVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  .dependencies['react-native'];

const existing = ['ios', 'android'].filter((d) => existsSync(join(root, d)));
if (existing.length && !force) {
  console.log(`${existing.join(' and ')} already present — nothing to do. Re-run with --force to regenerate.`);
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), 'amthal-portal-prebuild-'));
console.log(`Generating ${appName} native projects for react-native ${rnVersion}…`);

try {
  execFileSync(
    'npx',
    ['--yes', '@react-native-community/cli@latest', 'init', appName,
     '--version', rnVersion, '--directory', join(tmp, appName),
     '--skip-install', '--skip-git-init', '--install-pods', 'false'],
    { stdio: 'inherit', cwd: tmp },
  );

  for (const dir of ['ios', 'android']) {
    const from = join(tmp, appName, dir);
    const to = join(root, dir);
    if (!existsSync(from)) throw new Error(`template produced no ${dir}/ — aborting`);
    if (existsSync(to)) rmSync(to, { recursive: true, force: true });
    renameSync(from, to);
    console.log(`  ✓ ${dir}/`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`
Done. Next:
  cd ios && pod install && cd ..     # iOS only
  npm run ios                        # or: npm run android
`);
