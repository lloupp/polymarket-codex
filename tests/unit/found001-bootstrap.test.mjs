import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

test('FOUND-001: deve ter estrutura base de diretórios', () => {
  const expectedDirs = ['src', 'tests', 'config', 'docs'];
  for (const dir of expectedDirs) {
    assert.equal(exists(dir), true, `Diretório ausente: ${dir}`);
  }
});

test('FOUND-001: package.json deve conter scripts essenciais', () => {
  assert.equal(exists('package.json'), true, 'package.json ausente');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));

  const requiredScripts = ['build', 'test', 'lint', 'dev'];
  for (const script of requiredScripts) {
    assert.ok(pkg.scripts?.[script], `Script ausente: npm run ${script}`);
  }
});
