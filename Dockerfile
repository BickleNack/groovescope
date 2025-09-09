# GrooveScope Backend Dockerfile
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install system dependencies for audio processing
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY . .

# Create temp directory for audio processing
RUN mkdir -p /tmp/groovescope && chmod 777 /tmp/groovescope

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S groovescope -u 1001

# Change ownership of the app directory
RUN chown -R groovescope:nodejs /app
RUN chown -R groovescope:nodejs /tmp/groovescope

# Switch to non-root user
USER groovescope

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start the application
CMD ["npm", "start"]
