// Детерминированная математика симуляции.
//
// Правило: в src/sim/ разрешены только + − × ÷ %, и из Math — sqrt, floor, ceil, round,
// trunc, abs, sign, min, max, imul, fround. Они по стандарту IEEE-754 дают одинаковые
// биты в любом движке. Math.sin/cos/pow и оператор ** — нет: V8 (Android) и
// JavaScriptCore (iPhone) расходятся в последних знаках, и счёт забега перестаёт
// сходиться при пересчёте на сервере. Поэтому синус и косинус здесь свои.

const PI = 3.141592653589793;
const DEG = PI / 180;

// Ряд Тейлора на отрезке |x| ≤ π/4: ошибка меньше 1e-13.
function sinPoly(x: number): number {
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800)))))))
  );
}

function cosPoly(x: number): number {
  const x2 = x * x;
  return (
    1 +
    x2 *
      (-1 / 2 +
        x2 *
          (1 / 24 +
            x2 * (-1 / 720 + x2 * (1 / 40320 + x2 * (-1 / 3628800 + x2 * (1 / 479001600 + x2 * (-1 / 87178291200)))))))
  );
}

/** Синус угла в градусах. */
export function sinDeg(deg: number): number {
  let d = deg % 360;
  if (d < 0) d += 360; // [0, 360)
  let sign = 1;
  if (d >= 180) {
    d -= 180;
    sign = -1;
  } // [0, 180)
  if (d > 90) d = 180 - d; // [0, 90]
  const r = d <= 45 ? sinPoly(d * DEG) : cosPoly((90 - d) * DEG);
  return sign * r;
}

/** Косинус угла в градусах. */
export function cosDeg(deg: number): number {
  return sinDeg(deg + 90);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
