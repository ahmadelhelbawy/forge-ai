import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const run = (a) => spawnSync('node', ['tools/watch.js', ...a], { encoding: 'utf8' });
test('--help exits 0', () => { assert.equal(run(['--help']).status, 0); });
test('missing dir exits 2', () => { assert.equal(run(['--dir', 'nope-nope']).status, 2); });
test('--once exits 0', () => { assert.equal(run(['--dir', 'tools', '--once']).status, 0); });
