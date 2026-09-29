# Imagem única: o mesmo processo serve o site e aceita as conexões WebSocket.
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
COPY server.js ./
# As pastas inteiras, e não arquivos escolhidos a dedo: o servidor importa as
# regras e a simulação do jogo, e estas importam outros módulos daqui; das
# contas, as regras do nome de piloto. Listar um por um já deixou a imagem sem
# `rules.ts` e sem `simulation.ts`, e a falha só aparecia ao subir o contêiner,
# não na build.
COPY src/game ./src/game
COPY src/conta ./src/conta
COPY tsconfig.server.json ./
EXPOSE 3001
CMD ["npm", "start"]
