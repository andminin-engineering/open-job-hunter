# Public beta announcement draft

## Spanish

Estamos abriendo la beta pública de **Open Job Hunter** 🎯

Es una aplicación open source que organiza postulaciones, busca oportunidades y evalúa compatibilidad utilizando IA local con Ollama. El perfil profesional y el historial permanecen en la computadora del usuario.

La beta pública es un programa de feedback, no una compilación aparte: se prueba con **v1.2.1**, la versión estable publicada en GitHub Releases.

Esta versión exige completar un perfil propio antes de evaluar, diagnostica si Ollama y el modelo configurado están listos, permite elegir español o inglés para la narrativa de evaluación y ofrece un tablero preparado para historiales grandes: búsqueda, orden, paginación y vistas separadas para procesos en curso, vacantes con oferta, rechazos y descartes. **Con oferta** significa que se recibió una propuesta; no implica que ya fue aceptada.

Buscamos personas de cualquier profesión —no solamente tecnología— que quieran probar el flujo y ayudarnos a detectar sesgos, errores y mejoras de experiencia.

### Cómo participar

1. Descargá v1.2.1 desde la página oficial de GitHub Releases.
2. Verificá el SHA-256 publicado junto al instalador.
3. Completá **Mi perfil**, elegí el idioma de las respuestas y probá una búsqueda o una vacante real.
4. Compartí una experiencia sin datos personales mediante el formulario de Beta feedback.

Si el proyecto te resulta útil, una ⭐ en GitHub ayuda a que otras personas lo descubran. La estrella es bienvenida, pero nunca es obligatoria para probar, informar problemas o contribuir.

El proyecto solicitó la firma de código mediante SignPath Foundation y está pendiente de aprobación. Los ejecutables de Windows de v1.2.1 no están firmados.

- Repositorio: https://github.com/andminin-engineering/open-job-hunter
- Descarga (v1.2.1 estable): https://github.com/andminin-engineering/open-job-hunter/releases/tag/v1.2.1
- Guía de prueba: https://github.com/andminin-engineering/open-job-hunter/blob/main/docs/BETA_TESTING.md
- Compartir feedback: https://github.com/andminin-engineering/open-job-hunter/issues/new?template=beta-feedback.yml

Open Job Hunter no automatiza postulaciones ni reemplaza el criterio profesional. Las recomendaciones de IA deben revisarse antes de tomar decisiones.

## Publication record

- Release: [Open Job Hunter v1.2.1](https://github.com/andminin-engineering/open-job-hunter/releases/tag/v1.2.1)
- Tag: `v1.2.1`
- Source commit: `5f7b49e38887aed99f7673471fa4233bdf9da191`
- Published: 2026-10-06
- Channel: stable GitHub Release; the public beta remains the feedback program.
- Accountable human owner: Andrea Minín / `andminin-engineering`
- Verification: [release workflow](https://github.com/andminin-engineering/open-job-hunter/actions/runs/37542133270), Microsoft Defender, SHA-256 manifest, CycloneDX SBOM and GitHub attestations.

The release, guide, feedback form and `/releases/latest` link were checked after publication. Before posting to another channel, open its final links from a signed-out browser session.
