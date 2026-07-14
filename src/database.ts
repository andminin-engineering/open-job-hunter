import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import { dirname, join } from 'path';

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

// Use project-root path so the same database file is used in both build and dev runs.
const DB_PATH = join(process.cwd(), 'src', 'data', 'db.json');

export function generarIdOferta(oferta: string, sourcePlatform: string, company?: string): string {
  const payload = `${oferta.trim().toLowerCase()}|${sourcePlatform.trim().toLowerCase()}|${(company ?? '').trim().toLowerCase()}`;
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

async function escribirBaseDatos(data: OfertaProcesada[]): Promise<void> {
  await mkdir(dirname(DB_PATH), { recursive: true });
  // Escritura atomica: escribir a un archivo temporal y renombrar.
  // Evita que la base quede truncada si el proceso muere o hay lecturas concurrentes a mitad de escritura.
  const tmpPath = `${DB_PATH}.tmp-${process.pid}`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  await rename(tmpPath, DB_PATH);
}

export async function leerBaseDatos(): Promise<OfertaProcesada[]> {
  try {
    const data = await readFile(DB_PATH, 'utf-8');
    return JSON.parse(data) as OfertaProcesada[];
  } catch {
    return [];
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
  const db = await leerBaseDatos();
  const id = generarIdOferta(input.oferta, input.sourcePlatform, input.company);
  const now = new Date().toISOString();
  const index = db.findIndex((item) => item.id === id);

  if (index >= 0) {
    const updated: OfertaProcesada = {
      ...db[index],
      oferta: input.oferta,
      sourcePlatform: input.sourcePlatform,
      expectedSalaryRange: input.expectedSalaryRange,
      company: input.company,
      jobUrl: input.jobUrl,
      recruiterEmail: input.recruiterEmail ?? db[index].recruiterEmail,
      applyUrl: input.applyUrl ?? db[index].applyUrl,
      requisitos: input.requisitos ?? db[index].requisitos,
      excluyentes: input.excluyentes ?? db[index].excluyentes,
      estado: input.estado,
      evaluacion: input.evaluacion,
      fechaActualizacion: now,
    };
    db[index] = updated;
    await escribirBaseDatos(db);
    return updated;
  }

  const nuevaOferta: OfertaProcesada = {
    id,
    oferta: input.oferta,
    sourcePlatform: input.sourcePlatform,
    expectedSalaryRange: input.expectedSalaryRange,
    company: input.company,
    jobUrl: input.jobUrl,
    recruiterEmail: input.recruiterEmail,
    applyUrl: input.applyUrl,
    requisitos: input.requisitos,
    excluyentes: input.excluyentes,
    estado: input.estado,
    evaluacion: input.evaluacion,
    feedbackHistorial: [],
    fechaProcesado: now,
    fechaActualizacion: now,
  };

  db.push(nuevaOferta);
  await escribirBaseDatos(db);
  return nuevaOferta;
}

export async function existeOferta(oferta: string, sourcePlatform: string, company?: string): Promise<OfertaProcesada | undefined> {
  const db = await leerBaseDatos();
  const id = generarIdOferta(oferta, sourcePlatform, company);
  return db.find((item) => item.id === id);
}

export async function actualizarEstadoOferta(id: string, estado: EstadoPostulacion): Promise<OfertaProcesada | undefined> {
  const db = await leerBaseDatos();
  const index = db.findIndex((item) => item.id === id);
  if (index < 0) {
    return undefined;
  }

  db[index] = {
    ...db[index],
    estado,
    fechaActualizacion: new Date().toISOString(),
  };

  await escribirBaseDatos(db);
  return db[index];
}

export async function agregarFeedbackOferta(id: string, feedback: FeedbackOferta): Promise<OfertaProcesada | undefined> {
  const db = await leerBaseDatos();
  const index = db.findIndex((item) => item.id === id);
  if (index < 0) {
    return undefined;
  }

  db[index] = {
    ...db[index],
    estado: 'feedback_recibido',
    feedbackHistorial: [...db[index].feedbackHistorial, feedback],
    fechaActualizacion: new Date().toISOString(),
  };

  await escribirBaseDatos(db);
  return db[index];
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
  const db = await leerBaseDatos();
  const index = db.findIndex((item) => item.id === id);
  if (index < 0) {
    return undefined;
  }

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
}