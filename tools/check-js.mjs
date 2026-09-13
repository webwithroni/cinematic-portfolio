import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve('src');

function walk(dir) {
  const results = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...walk(full));
      continue;
    }

    if (entry.isFile() && full.endsWith('.js')) {
      results.push(full);
    }
  }

  return results;
}

const files = walk(root);

let failed = false;

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], {
      stdio: 'pipe'
    });

    console.log(`OK  ${path.relative(process.cwd(), file)}`);
  } catch (error) {
    failed = true;

    console.error(`FAIL ${path.relative(process.cwd(), file)}`);
    console.error(String(error.stderr || error.message));
  }
}

if (failed) {
  process.exit(1);
}
