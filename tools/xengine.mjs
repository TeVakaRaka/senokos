// Проверка «два движка»: одна и та же симуляция в Node (V8, как на Android и в Chrome)
// и в системном jsc (JavaScriptCore, как на iPhone). Хеши на 20 зёрнах обязаны совпасть.
// Запуск: npm run xengine

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const bundle = fileURLToPath(new URL('../dist-sim/xengine.js', import.meta.url));
const JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc';

if (!existsSync(bundle)) {
  console.error('Нет dist-sim/xengine.js — сначала сборка: vite build --config vite.sim.config.ts');
  process.exit(1);
}

// jsc не открывает файл по пути с кириллицей («МОИ ПРОЕКТЫ»), поэтому запускаем
// из папки сборки и передаём только имя файла.
const distDir = fileURLToPath(new URL('../dist-sim/', import.meta.url));
const run = (cmd) =>
  execFileSync(cmd, ['xengine.js'], { encoding: 'utf8', cwd: distDir }).trim().split('\n');

const v8 = run(process.execPath);
console.log(`Node ${process.version} (V8): ${v8.length} зёрен`);

if (!existsSync(JSC)) {
  console.log('jsc не найден — сравнение с JavaScriptCore пропущено.');
  console.log(v8.join('\n'));
  process.exit(0);
}

const jsc = run(JSC);
let mismatches = 0;
console.log('зерно  V8        JSC       кустиков  взмахов');
for (let i = 0; i < Math.max(v8.length, jsc.length); i++) {
  const a = (v8[i] ?? '').split(' ');
  const b = (jsc[i] ?? '').split(' ');
  const same = v8[i] === jsc[i];
  if (!same) mismatches++;
  console.log(
    `${(a[0] ?? '?').padStart(5)}  ${a[1] ?? '?'}  ${b[1] ?? '?'}  ${(a[2] ?? '?').padStart(8)}  ${(a[3] ?? '?').padStart(7)}  ${same ? 'совпало' : 'РАСХОЖДЕНИЕ'}`,
  );
}

if (mismatches > 0) {
  console.error(`\nРасхождений: ${mismatches}. Симуляция считает по-разному в V8 и JavaScriptCore.`);
  process.exit(1);
}
console.log('\nV8 и JavaScriptCore дали одинаковые хеши на всех зёрнах.');
