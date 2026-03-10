# Local development Dockerfile (production uses Lambda)
FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

ENV NODE_ENV=development
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "run", "dev"]
