/**
 * Télécharge les 114 sourates de Cheikh Sudais depuis mp3quran.net (128kbps)
 * et les transcode en 64kbps via ffmpeg (binaire système, installé dans
 * l'image Docker — voir Dockerfile), pour l'écoute hors-ligne du mode Tajwid
 * (voir src/modules/audio/ côté API, constants/audioDownload.ts côté app).
 *
 * Script ponctuel, idempotent (skip un fichier déjà présent) : à relancer
 * seulement si les fichiers sources changent ou en cas d'échec partiel.
 *
 *   AUDIO_STORAGE_DIR="…" npx tsx prisma/transcodeSudais.ts
 *   docker compose -f docker-compose.prod.yml exec api npx tsx prisma/transcodeSudais.ts
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { mkdir, stat, writeFile, unlink, rm } from 'node:fs/promises';
import path from 'node:path';

const SUDAIS_BASE = 'https://server11.mp3quran.net/sds/';
const TARGET_BITRATE = '64k';
const TOTAL_SOURATES = 114;

const outDir = path.join(process.env.AUDIO_STORAGE_DIR ?? '/app/storage/audio', 'sudais');
const tmpDir = path.join(outDir, '_tmp');

async function fileExistsNonEmpty(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.size > 0;
  } catch {
    return false;
  }
}

function transcode(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-y', '-i', inputPath, '-b:a', TARGET_BITRATE, '-vn', outputPath]);
    let stderr = '';
    ff.stderr.on('data', (d) => { stderr += d; });
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`));
    });
  });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  await mkdir(tmpDir, { recursive: true });

  let ok = 0;
  let failed = 0;
  let skipped = 0;

  for (let numero = 1; numero <= TOTAL_SOURATES; numero++) {
    const nnn = String(numero).padStart(3, '0');
    const outPath = path.join(outDir, `${nnn}.mp3`);

    if (await fileExistsNonEmpty(outPath)) {
      console.log(`[${numero}/${TOTAL_SOURATES}] skip (déjà présent)`);
      skipped++;
      continue;
    }

    const srcUrl = `${SUDAIS_BASE}${nnn}.mp3`;
    console.log(`[${numero}/${TOTAL_SOURATES}] téléchargement...`);
    let buf: Buffer;
    try {
      const res = await fetch(srcUrl);
      if (!res.ok) {
        console.error(`[${numero}/${TOTAL_SOURATES}] ERREUR HTTP ${res.status}`);
        failed++;
        continue;
      }
      buf = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      console.error(`[${numero}/${TOTAL_SOURATES}] ERREUR téléchargement:`, e);
      failed++;
      continue;
    }

    const tmpIn = path.join(tmpDir, `${nnn}-src.mp3`);
    await writeFile(tmpIn, buf);
    console.log(`[${numero}/${TOTAL_SOURATES}] transcodage 64kbps...`);
    try {
      await transcode(tmpIn, outPath);
      console.log(`[${numero}/${TOTAL_SOURATES}] OK`);
      ok++;
    } catch (e) {
      console.error(`[${numero}/${TOTAL_SOURATES}] ERREUR transcodage:`, e);
      failed++;
    } finally {
      await unlink(tmpIn).catch(() => {});
    }
  }

  await rm(tmpDir, { recursive: true, force: true });

  console.log(`\nTerminé : ${ok} transcodés, ${skipped} déjà présents, ${failed} échoués.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
