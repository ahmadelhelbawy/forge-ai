import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { renderEmptyState } from '../web/empty-state.js';
const FROZEN = 'b98c049956023b48d7d1f85b9e7ec91c73f7b1d1e900aeb354571232c231a0ac';
test('tokens file byte-identical', () => {
  const raw = readFileSync(new URL('../web/tokens.json', import.meta.url), 'utf8');
  assert.equal(createHash('sha256').update(raw).digest('hex'), FROZEN);
});
test('role=status contract holds', () => {
  assert.match(renderEmptyState(), /role="status"/);
});
