# Use Node 18
FROM node:18

WORKDIR /app

# Copy package manifests
COPY backend/package*.json ./backend/

# Copy frontend assets
COPY frontend ./frontend

# Install backend dependencies (include dev for tsx runtime)
WORKDIR /app/backend
RUN npm install --production=false

# Copy backend source
COPY backend .

# Expose port
EXPOSE 3000

# Start backend (serves frontend + API + WS)
CMD ["npm", "run", "start"]
