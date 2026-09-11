# Etapa 1: Compilación del TypeScript
FROM node:20-alpine AS build-stage

WORKDIR /app

# Copiamos archivos de configuración del proyecto
COPY package*.json tsconfig.json ./

# Instalamos exactamente el grafo bloqueado, sin ejecutar lifecycle scripts de dependencias
RUN npm ci --ignore-scripts

# Copiamos la carpeta src completa
COPY ./src ./src

# Ejecutamos exclusivamente el compilador fijado en package-lock.json
RUN ./node_modules/.bin/tsc

# Etapa 2: Entorno de ejecución liviano de producción
FROM node:20-alpine AS runtime-stage

WORKDIR /app

# Copiamos paquetes e instalamos SOLO dependencias de producción
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Traemos la carpeta compilada 'build' desde la etapa anterior
COPY --from=build-stage /app/build ./build
COPY --from=build-stage /app/src/data/scheduler-config.json ./src/data/scheduler-config.json
COPY config ./config
COPY app ./app

RUN mkdir -p /app/data && chown -R node:node /app/data /app/config

ENV JOB_HUNTER_MODE=http
ENV HOST=0.0.0.0
ENV PROFILE_PATH=/app/config/profile.json
ENV JOB_HUNTER_DATA_DIR=/app/data

EXPOSE 3000

USER node

# Iniciamos el archivo JS resultante directamente
CMD ["node", "build/bin/http.js"]
