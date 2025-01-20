# Use an official Node.js runtime as a parent image
FROM node:18-slim

# Ensure system packages are up to date
RUN apt-get update && apt-get install -y \
  # Install required dependencies for Puppeteer/Chromium
  ca-certificates \
  fonts-liberation \
  libappindicator3-1 \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libffi8 \
  libgbm1 \
  libgcc1 \
  libgcrypt20 \
  libglib2.0-0 \
  libglu1-mesa \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libstdc++6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  wget \
  gnupg \
  # Clean up apt lists to keep image size small
  && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package.json/package-lock.json into the container
COPY package*.json ./
COPY .puppeteerrc.cjs ./

# Install node dependencies
RUN npm install

# Copy the rest of your application code
COPY . .

# Build your app (if using TypeScript)
RUN npm run build

# Start command
CMD ["npm", "start"]