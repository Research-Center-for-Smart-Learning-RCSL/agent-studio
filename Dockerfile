FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Full node_modules are kept (no standalone output) so the image can also run
# drizzle-kit migrations and the scripts/ import tools.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["sh", "-c", "npx drizzle-kit migrate && npx next start -p 3000"]
