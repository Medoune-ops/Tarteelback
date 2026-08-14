import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors.js';

const RECITER = 'sudais';
const BITRATE_KBPS = 64;
const FILENAME_RE = /^(\d{3})\.mp3$/;

function sudaisDir(): string {
  return path.join(env.AUDIO_STORAGE_DIR, RECITER);
}

function filePath(numero: number): string {
  return path.join(sudaisDir(), `${String(numero).padStart(3, '0')}.mp3`);
}

export interface ManifestEntry {
  numero: number;
  sizeBytes: number;
  sha256: string;
}

/**
 * Manifest des fichiers transcodés disponibles (produit par
 * prisma/transcodeSudais.ts, exécuté séparément — voir ce script). Les hash
 * sont calculés au premier appel puis mis en cache mémoire : 114 fichiers de
 * quelques centaines de Ko, coût négligible une fois, jamais recalculé après
 * (le contenu ne change pas en dehors d'un nouveau run du script + redeploy).
 */
let cachedManifest: ManifestEntry[] | null = null;

async function buildManifest(): Promise<ManifestEntry[]> {
  const dir = sudaisDir();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return []; // dossier absent : script pas encore lancé
  }

  const entries: ManifestEntry[] = [];
  for (const name of names.sort()) {
    const m = FILENAME_RE.exec(name);
    if (!m) continue;
    const numero = Number(m[1]);
    const full = path.join(dir, name);
    const [info, sha256] = await Promise.all([stat(full), hashFile(full)]);
    entries.push({ numero, sizeBytes: info.size, sha256 });
  }
  return entries;
}

function hashFile(full: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(full);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export const audioService = {
  /** GET /audio/sudais/manifest */
  async getManifest() {
    if (!cachedManifest) cachedManifest = await buildManifest();
    return { reciter: RECITER, bitrateKbps: BITRATE_KBPS, files: cachedManifest };
  },

  /** GET /audio/sudais/:numero — throws NOT_FOUND si absent. */
  async getFileStream(numero: number) {
    const full = filePath(numero);
    try {
      await stat(full);
    } catch {
      throw new AppError('NOT_FOUND', 'Audio file not found');
    }
    return createReadStream(full);
  },
};
