import test from 'node:test';
import assert from 'node:assert';
import { errorMessage, isBlockedError } from '../src/utils/errors';

test('errorMessage extracts data.message from RoyalError-like objects', () => {
  assert.equal(
    errorMessage({ data: { message: 'Response code 403 (Forbidden)' } }),
    'Response code 403 (Forbidden)',
  );
});

test('errorMessage falls back to message then string', () => {
  assert.equal(errorMessage(new Error('boom')), 'boom');
  assert.equal(errorMessage('plain failure'), 'plain failure');
});

test('isBlockedError detects Cloudflare and forbidden responses', () => {
  assert.equal(isBlockedError({ data: { message: 'Response code 403 (Forbidden)' } }), true);
  assert.equal(isBlockedError(new Error('Cloudflare challenge')), true);
  assert.equal(isBlockedError('Request failed with status code 403'), true);
});

test('isBlockedError ignores unrelated failures', () => {
  assert.equal(isBlockedError(new Error('Cannot read properties of undefined')), false);
  assert.equal(isBlockedError({ data: { message: 'Response code 500' } }), false);
});
