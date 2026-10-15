/*
 * A deliberately tiny schema validator for extension manifests (no dependencies).
 * PURE. Objects are STRICT by default: unknown fields are errors. That is how the "no script
 * injection field exists" guardrail for web music sources is enforced structurally.
 *
 * Schema nodes (plain objects):
 *   { type: 'string', pattern?, min?, max?, enum? }
 *   { type: 'number', min?, max?, int? }
 *   { type: 'boolean' }
 *   { type: 'array', of: node, min?, max? }
 *   { type: 'object', fields: { key: node }, strict?: true }   // `optional: true` on a field node
 *   { type: 'record', of: node }                               // any keys, values match `of`
 *   { type: 'i18n', optional? }                                // { en: string, ko: string } both required
 *   { type: 'any' }
 */

export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const typeName = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

/** Returns a list of { path, message }. Empty = valid. */
export function validate(schema, value, path = '') {
  const errors = [];
  const here = path || '(root)';
  const fail = (message) => errors.push({ path: here, message });

  switch (schema.type) {
    case 'any':
      break;

    case 'string': {
      if (typeof value !== 'string') return [{ path: here, message: `expected string, got ${typeName(value)}` }];
      if (schema.min != null && value.length < schema.min) fail(`must be at least ${schema.min} characters`);
      if (schema.max != null && value.length > schema.max) fail(`must be at most ${schema.max} characters`);
      if (schema.pattern && !schema.pattern.test(value)) fail(`"${value}" does not match ${schema.pattern}`);
      if (schema.enum && !schema.enum.includes(value)) fail(`"${value}" is not one of: ${schema.enum.join(', ')}`);
      break;
    }

    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return [{ path: here, message: `expected number, got ${typeName(value)}` }];
      if (schema.int && !Number.isInteger(value)) fail('must be an integer');
      if (schema.min != null && value < schema.min) fail(`must be >= ${schema.min}`);
      if (schema.max != null && value > schema.max) fail(`must be <= ${schema.max}`);
      break;
    }

    case 'boolean':
      if (typeof value !== 'boolean') fail(`expected boolean, got ${typeName(value)}`);
      break;

    case 'array': {
      if (!Array.isArray(value)) return [{ path: here, message: `expected array, got ${typeName(value)}` }];
      if (schema.min != null && value.length < schema.min) fail(`needs at least ${schema.min} item(s)`);
      if (schema.max != null && value.length > schema.max) fail(`allows at most ${schema.max} item(s)`);
      value.forEach((item, i) => errors.push(...validate(schema.of, item, `${path}[${i}]`)));
      break;
    }

    case 'record': {
      if (typeName(value) !== 'object') return [{ path: here, message: `expected object, got ${typeName(value)}` }];
      for (const [k, v] of Object.entries(value)) errors.push(...validate(schema.of, v, path ? `${path}.${k}` : k));
      break;
    }

    case 'i18n': {
      if (typeName(value) !== 'object') return [{ path: here, message: `expected {en, ko}, got ${typeName(value)}` }];
      for (const lang of ['en', 'ko']) {
        if (typeof value[lang] !== 'string' || value[lang].trim() === '') {
          errors.push({ path: path ? `${path}.${lang}` : lang, message: 'required non-empty string (every name needs en and ko)' });
        }
      }
      for (const k of Object.keys(value)) {
        if (k !== 'en' && k !== 'ko') errors.push({ path: path ? `${path}.${k}` : k, message: 'unknown language key (only en and ko are supported)' });
      }
      break;
    }

    case 'object': {
      if (typeName(value) !== 'object') return [{ path: here, message: `expected object, got ${typeName(value)}` }];
      const fields = schema.fields ?? {};
      for (const [key, node] of Object.entries(fields)) {
        const childPath = path ? `${path}.${key}` : key;
        if (!(key in value) || value[key] === undefined) {
          if (!node.optional) errors.push({ path: childPath, message: 'required field is missing' });
          continue;
        }
        errors.push(...validate(node, value[key], childPath));
      }
      if (schema.strict !== false) {
        for (const key of Object.keys(value)) {
          if (!(key in fields)) errors.push({ path: path ? `${path}.${key}` : key, message: 'unknown field (schema is strict)' });
        }
      }
      break;
    }

    default:
      throw new Error(`schema.js: unknown schema node type "${schema.type}"`);
  }
  return errors;
}

/** Helper: format errors for logs and the Settings > Extensions list. */
export function formatErrors(errors) {
  return errors.map((e) => `${e.path}: ${e.message}`);
}

// Small builders keep the contract files readable.
export const str = (opts = {}) => ({ type: 'string', ...opts });
export const num = (opts = {}) => ({ type: 'number', ...opts });
export const bool = (opts = {}) => ({ type: 'boolean', ...opts });
export const arr = (of, opts = {}) => ({ type: 'array', of, ...opts });
export const obj = (fields, opts = {}) => ({ type: 'object', fields, ...opts });
export const rec = (of, opts = {}) => ({ type: 'record', of, ...opts });
export const i18n = (opts = {}) => ({ type: 'i18n', ...opts });
export const oneOf = (values, opts = {}) => ({ type: 'string', enum: values, ...opts });
export const opt = (node) => ({ ...node, optional: true });
