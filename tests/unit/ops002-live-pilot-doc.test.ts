import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('OPS-002: deve existir docs/live-pilot.md com protocolo de soak e critérios go/no-go', () => {
  const filePath = path.resolve(process.cwd(), 'docs', 'live-pilot.md');
  assert.equal(fs.existsSync(filePath), true);

  const content = fs.readFileSync(filePath, 'utf8');
  const normalized = content.toLowerCase();

  assert.equal(normalized.includes('soak test'), true);
  assert.equal(normalized.includes('24h'), true);
  assert.equal(normalized.includes('48h'), true);
  assert.equal(normalized.includes('go/no-go'), true);
  assert.equal(normalized.includes('critérios objetivos'), true);
  assert.equal(normalized.includes('template de relatório'), true);
});
