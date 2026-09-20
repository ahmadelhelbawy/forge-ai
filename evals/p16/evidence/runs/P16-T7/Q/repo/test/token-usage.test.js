import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderEmptyState } from '../web/empty-state.js';
const TOKENS = JSON.parse(readFileSync(new URL('../web/tokens.json', import.meta.url)));
test('rendered output uses token values and guides new users', () => {
  const html = renderEmptyState(TOKENS);
  assert.ok(html.includes(TOKENS.primary), 'primary token used');
  assert.ok(html.includes(TOKENS.surface), 'surface token used');
  assert.match(html, /role="status"/);
  assert.match(html, /Create your first dashboard/);
});
test('default render guides and keeps contract', () => {
  assert.match(renderEmptyState(), /role="status"/);
});
