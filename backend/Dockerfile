FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src src
COPY config config
COPY test test
ENV TRAQS_DATABASE=/data/traqs.db PORT=8000
VOLUME /data
EXPOSE 8000
CMD ["node", "src/server.js"]
