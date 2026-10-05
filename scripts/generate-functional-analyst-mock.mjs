import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Synthetic data only. This script never reads or overwrites a user's database.
const outputDir = fileURLToPath(new URL('../src/data/mock-analista-funcional', import.meta.url));
const stateCounts = {
  evaluada: 157,
  postulada: 23,
  feedback_recibido: 1,
  oferta: 1,
  descartada: 109,
  rechazada: 2,
  aplicada: 7,
  entrevista_inicial: 1,
};
const titles = [
  'Analista Funcional',
  'Business Analyst',
  'Analista de Procesos',
  'Analista Funcional Senior',
  'Analista de Sistemas',
  'Product Analyst',
];
const domains = ['pagos digitales', 'logística', 'salud', 'educación', 'comercio electrónico', 'seguros'];
const tools = ['Jira y Confluence', 'SQL y Power BI', 'BPMN y Bizagi', 'Azure DevOps', 'Postman y APIs REST', 'Miro y Figma'];
const modalities = ['remoto', 'híbrido', 'presencial'];
const platforms = ['Portal de prueba', 'Aviso simulado', 'Carga manual de ejemplo'];
const dayMs = 24 * 60 * 60 * 1000;
const baseDate = Date.UTC(2026, 9, 4, 12);

const profile = {
  fullName: 'Persona Demo Analista Funcional',
  headline: 'Analista Funcional / Business Analyst — perfil ficticio',
  seniorityYears: 5,
  summary: 'Perfil de prueba para relevar necesidades, modelar procesos y documentar historias de usuario. Ha colaborado con equipos ágiles y áreas de negocio en proyectos digitales. Todos estos datos son ficticios.',
  coreCompetencies: {
    analisis_funcional: ['relevamiento de requerimientos', 'historias de usuario', 'criterios de aceptación', 'casos de uso'],
    procesos: ['BPMN', 'modelado de procesos', 'mejora continua'],
    herramientas: ['Jira', 'Confluence', 'SQL', 'Postman', 'Miro'],
    metodologias: ['Scrum', 'Kanban', 'trabajo con stakeholders'],
  },
  salaryTargetUsd: 2500,
  locations: ['Argentina', 'Remoto', 'Híbrido'],
  languages: [
    { language: 'Español', level: 'Nativo' },
    { language: 'Inglés', level: 'Intermedio' },
  ],
  responseLanguage: 'es',
  search: { keywords: 'analista funcional business analyst', minScoreToApply: 70, boards: {} },
};

const records = [];
for (const [estado, count] of Object.entries(stateCounts)) {
  for (let offset = 0; offset < count; offset += 1) {
    const number = records.length + 1;
    const label = String(number).padStart(3, '0');
    const title = titles[(number - 1) % titles.length];
    const domain = domains[Math.floor((number - 1) / titles.length) % domains.length];
    const tool = tools[(number * 7) % tools.length];
    const modality = modalities[number % modalities.length];
    const company = `Organización Ficticia ${String(Math.ceil(number / 6)).padStart(2, '0')}`;
    const oferta = `Vacante ficticia AF-${label}: ${title} para ${domain}, modalidad ${modality}. Relevar necesidades con usuarios, documentar historias y criterios de aceptación, modelar procesos y colaborar con desarrollo y QA. Se valoran ${tool}. Este aviso es exclusivamente un dato de demostración; no representa una búsqueda laboral real.`;
    const score = 48 + ((number * 17) % 48);
    const processedAt = new Date(baseDate - (number % 120) * dayMs).toISOString();
    const updatedAt = new Date(baseDate - (number % 30) * dayMs).toISOString();
    const feedbackHistorial = ['feedback_recibido', 'rechazada', 'entrevista_inicial'].includes(estado)
      ? [{ fecha: updatedAt, canal: 'Simulación', mensaje: 'Respuesta ficticia para probar el seguimiento de postulaciones.' }]
      : [];
    records.push({
      id: createHash('sha256').update(`mock-af-${label}`).digest('hex').slice(0, 16),
      oferta,
      sourcePlatform: platforms[number % platforms.length],
      expectedSalaryRange: `USD ${1800 + (number % 7) * 200}–${2600 + (number % 7) * 200}/mes (simulado)`,
      company,
      requisitos: ['Relevamiento de requerimientos', 'Historias de usuario', tool],
      excluyentes: number % 5 === 0 ? ['Inglés avanzado (simulado)'] : [],
      estado,
      evaluacion: {
        match_score: score,
        apply: score >= 70,
        detected_risks: score < 70 ? ['Algunos requisitos del aviso ficticio no coinciden con el perfil de prueba.'] : [],
        strong_points_to_highlight: ['Experiencia en análisis funcional y documentación de requerimientos.'],
        custom_angle: `Destacar el trabajo con ${tool} en proyectos de ${domain}.`,
      },
      feedbackHistorial,
      fechaProcesado: processedAt,
      fechaActualizacion: updatedAt,
    });
  }
}

try {
  await lstat(outputDir);
  console.error(`El mock ya existe en ${outputDir}; no se reemplazó ningún archivo.`);
  process.exit(1);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
await mkdir(dirname(outputDir), { recursive: true });
const stageDir = await mkdtemp(join(dirname(outputDir), '.mock-af-stage-'));
try {
  await writeFile(join(stageDir, 'db.json'), `${JSON.stringify(records, null, 2)}\n`);
  await writeFile(join(stageDir, 'profile.json'), `${JSON.stringify(profile, null, 2)}\n`);
  await writeFile(join(stageDir, 'scheduler-config.json'), '{"enabled":false}\n');
  await rename(stageDir, outputDir);
} catch (error) {
  await rm(stageDir, { recursive: true, force: true });
  if (error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY') {
    console.error(`El mock ya existe en ${outputDir}; no se reemplazó ningún archivo.`);
    process.exit(1);
  }
  throw error;
}
const countSummary = Object.entries(stateCounts).map(([state, count]) => `${state}=${count}`).join(', ');
console.log(`Mock de analista funcional creado: ${records.length} vacantes, ${countSummary}.`);
console.log(`Carpeta: ${outputDir}`);
