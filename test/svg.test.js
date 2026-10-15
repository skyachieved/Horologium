import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSvgSafety } from '../src/core/svg.js';

const ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g data-part="body"><circle cx="5" cy="5" r="4"/></g></svg>';

test('plain artwork passes, including an XML prolog and comments', () => {
  assert.deepEqual(checkSvgSafety(ok), []);
  assert.deepEqual(checkSvgSafety(`<?xml version="1.0"?>\n<!-- made by hand -->\n${ok}`), []);
  assert.deepEqual(checkSvgSafety('<svg viewBox="0 0 1 1"><style>.a{fill:red}</style><use href="#a"/></svg>'), []);
});

test('structure problems', () => {
  assert.deepEqual(checkSvgSafety(''), ['file is empty']);
  assert.match(checkSvgSafety('<div/>')[0], /must start with an <svg>/);
  assert.match(checkSvgSafety('<svg><circle/></svg>').join(), /viewBox/);
});

test('anything that could run code or phone home is rejected', () => {
  const cases = {
    script: '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>',
    foreignObject: '<svg viewBox="0 0 1 1"><foreignObject><div/></foreignObject></svg>',
    handler: '<svg viewBox="0 0 1 1"><circle onclick="x()"/></svg>',
    handlerUpper: '<svg viewBox="0 0 1 1"><circle ONLOAD = "x()"/></svg>',
    jsUrl: '<svg viewBox="0 0 1 1"><a href="javascript:alert(1)"><circle/></a></svg>',
    remoteHref: '<svg viewBox="0 0 1 1"><image href="https://evil.example/x.png"/></svg>',
    remoteXlink: '<svg viewBox="0 0 1 1"><image xlink:href="//evil.example/x.png"/></svg>',
    remoteUrl: '<svg viewBox="0 0 1 1"><rect style="fill:url(https://evil.example/p)"/></svg>',
    import: '<svg viewBox="0 0 1 1"><style>@import "x.css";</style></svg>',
    iframe: '<svg viewBox="0 0 1 1"><iframe src="x"/></svg>',
  };
  for (const [name, svg] of Object.entries(cases)) {
    assert.ok(checkSvgSafety(svg).length > 0, `${name} should be rejected`);
  }
});

test('a script hidden inside a comment is not a false positive', () => {
  assert.deepEqual(checkSvgSafety(`<svg viewBox="0 0 1 1"><!-- <script>old</script> --><circle/></svg>`), []);
});
