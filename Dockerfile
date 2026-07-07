# TIDEHOLD — single-container deployment: one Node process serves the API,
# the WebSocket feed, and the built client.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
VOLUME /app/data
EXPOSE 8080
CMD ["npm", "run", "start"]
