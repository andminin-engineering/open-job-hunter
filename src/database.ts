import { mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { createHash, randomUUID } from 'crypto';
import { dirname, join } from 'path';
import { DB_PATH } from './paths.js';

export type EstadoPostulacion =
  | 'nueva'
  | 'evaluada'
  | 'descartada'
  | 'postulada'
  | 'feedback_recibido'
  | 'entrevista'
  | 'rechazada'
  | 'oferta';

export interface EvaluacionOferta {
  match_score: number;
  apply: boolean;
  detected_risks: string[];
  strong_points_to_highlight: string[];
  custom_angle: string;
}

export interface FeedbackOferta {
  fecha: string;
  canal: string;
  mensaje: string;
  accionRecomendada?: string;
}

export interface OfertaProcesada {
  id: string;
  oferta: string;
  sourcePlatform: string;
  expectedSalaryRange?: string;
  company?: string;
  jobUrl?: string;
  recruiterEmail?: string;
  applyUrl?: string;
  requisitos?: string[];
  excluyentes?: string[];
  estado: EstadoPostulacion;
  evaluacion?: EvaluacionOferta;
  feedbackHistorial: FeedbackOferta[];
  fechaProcesado: string;
  fechaActualizacion: string;
}

const LOCK_PATH = `${DB_PATH}.lock`;
const LOCK_OWNER_PATH = join(LOCK_PATH, 'owner.json');
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 30_000;

interface LockOwner { pid: number; token: string; createdAt: string }

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

async function readLockOwner(): Promise<LockOwner | undefined> {
  try {
    const value = JSON.parse(await readFile(LOCK_OWNER_PATH, 'utf-8')) as Partial<LockOwner>;
    if (typeof value.pid !== 'number' || typeof value.token !== 'string' || typeof value.createdAt !== 'string') return undefined;
    return value as LockOwner;
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error, 'EPERM');
  }
}

async function acquireDatabaseLock(): Promise<() => Promise<void>> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  await mkdir(dirname(DB_PATH), { recursive: true });
  while (true) {
    try {
      await mkdir(LOCK_PATH);
      const owner: LockOwner = { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() };
      try {
        await writeFile(LOCK_OWNER_PATH, JSON.stringify(owner), { encoding: 'utf-8', flag: 'wx' });
      } catch (error) {
        await rm(LOCK_PATH, { recursive: true, force: true });
        throw error;
      }
      return async () => {
        const currentOwner = await readLockOwner();
        if (currentOwner?.token === owner.token) await rm(LOCK_PATH, { recursive: true, force: true });
      };
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) throw error;
      try {
        const lockStat = await stat(LOCK_PATH);
        if (Date.now() - lockStat.mtimeMs > STALE_LOCK_MS) {
          const owner = await readLockOwner();
          if (!owner || !isProcessAlive(owner.pid)) {
            await rm(LOCK_PATH, { recursive: true, force: true });
            continue;
          }
        }
      } catch (statError) {
        if (isNodeError(statError, 'ENOENT')) continue;
        throw statError;
      }
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for database lock at ${DB_PATH}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

async function withDatabaseMutation<T>(operation: () => Promise<T>): Promise<T> {
  const release = await acquireDatabaseLock();
  try { return await operation(); } finally { await release(); }
}

export function generarIdOferta(oferta: string, sourcePlatform: string, company?: string): string {
  const payload = `${oferta.trim().toLowerCase()}|${sourcePlatform.trim().toLowerCase()}|${(company ?? '').trim().toLowerCase()}`;
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

async function escribirBaseDatos(data: OfertaProcesada[]): Promise<void> {
  await mkdir(dirname(DB_PATH), { recursive: true });
  // Escritura atomica: escribir a un archivo temporal y renombrar.
  // Evita que la base quede truncada si el proceso muere o hay lecturas concurrentes a mitad de escritura.
  const tmpPath = `${DB_PATH}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    await rename(tmpPath, DB_PATH);
  } finally {
    await rm(tmpPath, { force: true });
  }
}

export async function leerBaseDatos(): Promise<OfertaProcesada[]> {
  try {
    const data = await readFile(DB_PATH, 'utf-8');
    return JSON.parse(data) as OfertaProcesada[];
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return [];
    throw new Error(`Could not read database at ${DB_PATH}`, { cause: error });
  }
}

export async function guardarOferta(input: {
  oferta: string;
  sourcePlatform: string;
  expectedSalaryRange?: string;
  company?: string;
  jobUrl?: string;
  recruiterEmail?: string;
  applyUrl?: string;
  requisitos?: string[];
  excluyentes?: string[];
  estado: EstadoPostulacion;
  evaluacion?: EvaluacionOferta;
}): Promise<OfertaProcesada> {
  return withDatabaseMutation(async () => {
    const db = await leerBaseDatos();
    const id = generarIdOferta(input.oferta, input.sourcePlatform, input.company);
    const now = new Date().toISOString();
    const index = db.findIndex((item) => item.id === id);

    if (index >= 0) {
      const updated: OfertaProcesada = {
        ...db[index], oferta: input.oferta, sourcePlatform: input.sourcePlatform,
        expectedSalaryRange: input.expectedSalaryRange, company: input.company, jobUrl: input.jobUrl,
        recruiterEmail: input.recruiterEmail ?? db[index].recruiterEmail,
        applyUrl: input.applyUrl ?? db[index].applyUrl,
        requisitos: input.requisitos ?? db[index].requisitos,
        excluyentes: input.excluyentes ?? db[index].excluyentes,
        estado: input.estado, evaluacion: input.evaluacion, fechaActualizacion: now,
      };
      db[index] = updated;
      await escribirBaseDatos(db);
      return updated;
    }

    const nuevaOferta: OfertaProcesada = {
      id, oferta: input.oferta, sourcePlatform: input.sourcePlatform,
      expectedSalaryRange: input.expectedSalaryRange, company: input.company, jobUrl: input.jobUrl,
      recruiterEmail: input.recruiterEmail, applyUrl: input.applyUrl,
      requisitos: input.requisitos, excluyentes: input.excluyentes,
      estado: input.estado, evaluacion: input.evaluacion, feedbackHistorial: [],
      fechaProcesado: now, fechaActualizacion: now,
    };

    db.push(nuevaOferta);
    await escribirBaseDatos(db);
    return nuevaOferta;
  });
}

export async function existeOferta(oferta: string, sourcePlatform: string, company?: string): Promise<OfertaProcesada | undefined> {
  const db = await leerBaseDatos();
  const id = generarIdOferta(oferta, sourcePlatform, company);
  return db.find((item) => item.id === id);
}

export async function actualizarEstadoOferta(id: string, estado: EstadoPostulacion): Promise<OfertaProcesada | undefined> {
  return withDatabaseMutation(async () => {
    const db = await leerBaseDatos();
    const index = db.findIndex((item) => item.id === id);
    if (index < 0) return undefined;

  db[index] = {
    ...db[index],
    estado,
    fechaActualizacion: new Date().toISOString(),
  };

    await escribirBaseDatos(db);
    return db[index];
  });
}

export async function agregarFeedbackOferta(id: string, feedback: FeedbackOferta): Promise<OfertaProcesada | undefined> {
  return withDatabaseMutation(async () => {
    const db = await leerBaseDatos();
    const index = db.findIndex((item) => item.id === id);
    if (index < 0) return undefined;

  db[index] = {
    ...db[index],
    estado: 'feedback_recibido',
    feedbackHistorial: [...db[index].feedbackHistorial, feedback],
    fechaActualizacion: new Date().toISOString(),
  };

    await escribirBaseDatos(db);
    return db[index];
  });
}

export async function listarOfertas(estado?: EstadoPostulacion): Promise<OfertaProcesada[]> {
  const db = await leerBaseDatos();
  if (!estado) {
    return db;
  }
  return db.filter((item) => item.estado === estado);
}

export async function obtenerOfertaPorId(id: string): Promise<OfertaProcesada | undefined> {
  const db = await leerBaseDatos();
  return db.find((item) => item.id === id);
}

export async function actualizarOfertaMetadata(id: string, patch: {
  recruiterEmail?: string;
  applyUrl?: string;
  requisitos?: string[];
  excluyentes?: string[];
}): Promise<OfertaProcesada | undefined> {
  return withDatabaseMutation(async () => {
    const db = await leerBaseDatos();
    const index = db.findIndex((item) => item.id === id);
    if (index < 0) return undefined;

  db[index] = {
    ...db[index],
    recruiterEmail: patch.recruiterEmail ?? db[index].recruiterEmail,
    applyUrl: patch.applyUrl ?? db[index].applyUrl,
    requisitos: patch.requisitos ?? db[index].requisitos,
    excluyentes: patch.excluyentes ?? db[index].excluyentes,
    fechaActualizacion: new Date().toISOString(),
  };

    await escribirBaseDatos(db);
    return db[index];
  });
}
