# Use a multi-stage build to keep the final image small

# Build the React frontend
FROM node:18-alpine AS builder
WORKDIR /app/frontend
COPY ./frontend/package*.json ./
RUN npm install
COPY ./frontend .
RUN npm run build

#  Build Node.js backend 
FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/frontend/build ./frontend/build
COPY ./backend/package*.json ./backend/
WORKDIR /app/backend
ENV NODE_ENV=production
RUN npm install
COPY ./backend .
EXPOSE 3001
CMD ["node", "index.js"]
