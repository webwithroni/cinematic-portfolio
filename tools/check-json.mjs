import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');

function walk(dir) {
  const results = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === '.git' ||
      entry.name === 'dist'
    ) {
      continue;
    }

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...walk(full));
      continue;
    }

    if (entry.isFile() && full.endsWith('.json')) {
      results.push(full);
    }
  }

  return results;
}

const files = walk(root);

let failed = false;

for (const file of files) {
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
    console.log(`OK  ${path.relative(process.cwd(), file)}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${path.relative(process.cwd(), file)}`);
    console.error(error.message);
  }
}

if (failed) {
  process.exit(1);
}
