import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, formatErrors, ID_PATTERN, str, num, bool, arr, obj, rec, i18n, oneOf, opt } from '../src/core/schema.js';

const paths = (errors) => errors.map((e) => e.path).sort();

test('primitives: types, ranges, patterns, enums', () => {
  assert.deepEqual(validate(str(), 'x'), []);
  assert.equal(validate(str(), 5).length, 1);
  assert.equal(validate(str({ pattern: ID_PATTERN }), 'Not Kebab').length, 1);
  assert.deepEqual(validate(str({ pattern: ID_PATTERN }), 'jazzy-study'), []);
  assert.equal(validate(num({ min: 1, max: 3, int: true }), 2.5).length, 1);
  assert.deepEqual(validate(num({ min: 1, max: 3, int: true }), 2), []);
  assert.equal(validate(num(), Number.NaN).length, 1);
  assert.equal(validate(oneOf(['a', 'b']), 'c').length, 1);
  assert.equal(validate(bool(), 'yes').length, 1);
});

test('objects are strict: unknown fields are errors, optional fields may be absent', () => {
  const schema = obj({ id: str(), note: opt(str()) });
  assert.deepEqual(validate(schema, { id: 'a' }), []);
  assert.deepEqual(validate(schema, { id: 'a', note: 'n' }), []);
  assert.deepEqual(paths(validate(schema, { id: 'a', extra: 1 })), ['extra']);
  assert.deepEqual(paths(validate(schema, {})), ['id']);
  assert.deepEqual(validate(obj({ id: str() }, { strict: false }), { id: 'a', extra: 1 }), []);
});

test('i18n needs non-empty en and ko and nothing else', () => {
  assert.deepEqual(validate(i18n(), { en: 'Hi', ko: '안녕' }), []);
  assert.deepEqual(paths(validate(i18n(), { en: 'Hi' })), ['ko']);
  assert.deepEqual(paths(validate(i18n(), { en: 'Hi', ko: '  ' })), ['ko']);
  assert.deepEqual(paths(validate(i18n(), { en: 'Hi', ko: 'x', fr: 'Salut' })), ['fr']);
  assert.equal(validate(i18n(), 'Hi').length, 1);
});

test('arrays and records validate each element with a path', () => {
  const schema = obj({ tags: arr(str(), { min: 1, max: 2 }), bag: rec(num()) });
  assert.deepEqual(validate(schema, { tags: ['a'], bag: { x: 1 } }), []);
  assert.deepEqual(paths(validate(schema, { tags: [], bag: {} })), ['tags']);
  assert.deepEqual(paths(validate(schema, { tags: ['a', 'b', 'c'], bag: {} })), ['tags']);
  assert.deepEqual(paths(validate(schema, { tags: ['a', 3], bag: { x: 'no' } })), ['bag.x', 'tags[1]']);
});

test('nested paths and formatting are readable', () => {
  const schema = obj({ web: obj({ url: str({ pattern: /^https:\/\// }) }) });
  const errors = validate(schema, { web: { url: 'http://x' } });
  assert.equal(errors[0].path, 'web.url');
  assert.match(formatErrors(errors)[0], /^web\.url: /);
});

test('non-objects at the root are reported once, not thrown', () => {
  assert.equal(validate(obj({ a: str() }), null).length, 1);
  assert.equal(validate(obj({ a: str() }), []).length, 1);
});
