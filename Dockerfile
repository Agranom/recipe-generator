# Use an official Node.js runtime as a parent image
FROM node:18-slim

# Ensure CA certificates are present for outbound HTTPS (axios)
RUN apt-get update && apt-get install -y \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package.json/package-lock.json into the container
COPY package*.json ./

# Install node dependencies
RUN npm install

# Copy the rest of your application code
COPY . .

# Build your app (TypeScript)
RUN npm run build

# Start command
CMD ["npm", "start"]
