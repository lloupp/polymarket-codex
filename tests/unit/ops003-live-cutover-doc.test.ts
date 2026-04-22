import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('OPS-003: deve existir playbook de cutover com rollback, critérios de abort e janelas de monitoramento', () => {
  const docPath = path.resolve(process.cwd(), 'docs/live-cutover.md');
  assert.equal(fs.existsSync(docPath), true, 'docs/live-cutover.md não encontrado');

  const content = fs.readFileSync(docPath, 'utf-8').toLowerCase();

  assert.match(content, /pré-cutover|pre-cutover/);
  assert.match(content, /cutover controlado/);
  assert.match(content, /rollback/);
  assert.match(content, /critérios de abort|criterios de abort/);
  assert.match(content, /janelas de monitoramento/);
  assert.match(content, /go\/no-go|go no-go/);
});
