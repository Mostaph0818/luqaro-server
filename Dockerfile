FROM node:24-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy workspace config files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json tsconfig.json ./

# Copy all needed packages
COPY lib/api-zod ./lib/api-zod
COPY lib/db ./lib/db
COPY lib/api-spec ./lib/api-spec
COPY artifacts/api-server ./artifacts/api-server

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build the server
RUN pnpm --filter @workspace/api-server run build

EXPOSE 8080

ENV PORT=8080
ENV NODE_ENV=production

CMD ["node", "artifacts/api-server/dist/index.cjs"]
