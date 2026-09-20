import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
test('memory round-trip', () => { store.set('a', 'b'); assert.equal(store.get('a'), 'b'); });
