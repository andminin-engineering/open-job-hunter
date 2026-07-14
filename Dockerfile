# Etapa 1: Compilación del TypeScript
FROM node:20-alpine AS build-stage

WORKDIR /app

# Copiamos archivos de configuración del proyecto
COPY package*.json tsconfig.json ./

# Instalamos todas las dependencias (incluyendo devDependencies para tener 'tsc')
RUN npm install

# Copiamos la carpeta src completa
COPY ./src ./src

# Compilamos de forma nativa con npx tsc (esto genera la carpeta /build según tu tsconfig)
RUN npx tsc

# Etapa 2: Entorno de ejecución liviano de producción
FROM node:20-alpine AS runtime-stage

WORKDIR /app

# Copiamos paquetes e instalamos SOLO dependencias de producción
COPY package*.json ./
RUN npm ci --only=production

# Traemos la carpeta compilada 'build' desde la etapa anterior
COPY --from=build-stage /app/build ./build
COPY --from=build-stage /app/src/data/scheduler-config.json ./src/data/scheduler-config.json

EXPOSE 3000

# Iniciamos el archivo JS resultante directamente
CMD ["node", "build/index.js"]