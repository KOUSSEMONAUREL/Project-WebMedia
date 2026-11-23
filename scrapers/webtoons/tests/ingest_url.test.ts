import test from 'node:test';
import assert from 'node:assert';
import { isIngestableUrl, resolveHttpUrl } from '../src/url';

test('resolveHttpUrl resout les chemins relatifs sur baseUrl', () => {
  assert.equal(resolveHttpUrl('/manga/one', 'https://example.com'), 'https://example.com/manga/one');
  assert.equal(resolveHttpUrl('manga/one', 'https://example.com'), 'https://example.com/manga/one');
});

test('resolveHttpUrl conserve les URLs absolues http(s)', () => {
  assert.equal(resolveHttpUrl('https://cdn.example.com/a.jpg', 'https://example.com'), 'https://cdn.example.com/a.jpg');
  assert.equal(resolveHttpUrl('http://example.com/a', 'https://example.com'), 'http://example.com/a');
});

test('resolveHttpUrl rejette les valeurs vides ou non web', () => {
  assert.equal(resolveHttpUrl('', 'https://example.com'), '');
  assert.equal(resolveHttpUrl('   ', 'https://example.com'), '');
  assert.equal(resolveHttpUrl('javascript:alert(1)', 'https://example.com'), '');
  assert.equal(resolveHttpUrl('ftp://example.com/a', 'https://example.com'), '');
});

test('isIngestableUrl refuse les URLs relatives et les fragments seuls', () => {
  assert.equal(isIngestableUrl(''), false);
  assert.equal(isIngestableUrl('#293,1783982880000'), false);
  assert.equal(isIngestableUrl('/manga/one'), false);
  assert.equal(isIngestableUrl('manga/one'), false);
});

test('isIngestableUrl accepte http(s) et magnet', () => {
  assert.equal(isIngestableUrl('https://example.com/a'), true);
  assert.equal(isIngestableUrl('http://example.com/a'), true);
  assert.equal(isIngestableUrl('magnet:?xt=urn:btih:abc'), true);
});
