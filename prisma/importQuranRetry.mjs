/**
 * Lanceur robuste pour l'import du Coran (audio par mot).
 *
 * L'import d'une base distante (Render, latence élevée) peut caler sur les
 * grosses sourates (timeout de transaction). L'import étant IDEMPOTENT et
 * reprenant là où il s'est arrêté (skip des sourates déjà faites), il suffit de
 * le relancer plusieurs fois. Ce script automatise ces relances, puis lance le
 * re-seed de la leçon démo une fois l'import complet.
 *
 * Usage (DATABASE_URL doit pointer vers la base cible) :
 *   node prisma/importQuranRetry.mjs
 */
import { spawn } from 'node:child_process';

const MAX_ATTEMPTS = 12;
const SUCCESS_MARK = 'Quran import complete';

/** Exécute une commande npm, renvoie { code, sawSuccess }. */
function run(script) {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', script], {
      shell: true,
      env: process.env,
    });
    let sawSuccess = false;
    child.stdout.on('data', (d) => {
      const s = d.toString();
      process.stdout.write(s);
      if (s.includes(SUCCESS_MARK)) sawSuccess = true;
    });
    child.stderr.on('data', (d) => process.stderr.write(d.toString()));
    child.on('close', (code) => resolve({ code, sawSuccess }));
  });
}

let imported = false;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  console.log(`\n──── Import Coran : tentative ${attempt}/${MAX_ATTEMPTS} ────`);
  const { code, sawSuccess } = await run('seed:quran');
  if (sawSuccess || code === 0) {
    imported = true;
    console.log(`\n✅ Import Coran terminé (tentative ${attempt}).`);
    break;
  }
  console.log(`\n⚠️  Tentative ${attempt} interrompue (latence). Relance…`);
}

if (!imported) {
  console.error(`\n❌ Import non terminé après ${MAX_ATTEMPTS} tentatives. Relance le script.`);
  process.exit(1);
}

console.log('\n──── Re-seed de la leçon démo (audio par mot) ────');
const seed = await run('seed');
if (seed.code !== 0) {
  console.error('\n❌ Le re-seed a échoué.');
  process.exit(1);
}
console.log('\n🎉 Tout est appliqué : audio par mot importé + leçon démo branchée.');
