// Чистота симуляции: в src/sim/ разрешена только математика, одинаковая во всех движках,
// и нет обращений к браузеру и часам.

import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('../src/sim/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const ALLOWED_MATH = new Set([
  'sqrt',
  'floor',
  'ceil',
  'round',
  'trunc',
  'abs',
  'sign',
  'min',
  'max',
  'imul',
  'fround',
]);

const FORBIDDEN_GLOBALS =
  /\b(window|document|navigator|performance|localStorage|requestAnimationFrame|setTimeout|setInterval|Date|console|fetch)\b/;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('чистота симуляции', () => {
  const files = Object.entries(sources);

  it('файлы симуляции найдены', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  for (const [path, raw] of files) {
    const code = stripComments(raw);

    it(`${path}: только разрешённые функции Math`, () => {
      const used = [...code.matchAll(/\bMath\.(\w+)/g)].map((m) => m[1]!);
      const bad = used.filter((name) => !ALLOWED_MATH.has(name));
      expect(bad).toEqual([]);
    });

    it(`${path}: нет оператора **`, () => {
      expect(code.includes('**')).toBe(false);
    });

    it(`${path}: нет обращений к браузеру и часам`, () => {
      const match = code.match(FORBIDDEN_GLOBALS);
      expect(match ? match[0] : null).toBeNull();
    });
  }
});
