# Production Dockerfile for Frontend
FROM node:20-alpine as builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build with placeholder API URL (will be replaced at runtime)
ENV VITE_API_URL=__VITE_API_URL_PLACEHOLDER__
RUN npm run build

# Production stage
FROM nginx:alpine

# Install gettext for envsubst
RUN apk add --no-cache gettext

# Copy nginx config
COPY nginx.template.conf /etc/nginx/templates/default.conf.template

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Railway uses PORT env variable
ENV PORT=80
ENV VITE_API_URL=http://localhost:8000

# Start script: replace placeholder with actual URL, then start nginx
CMD ["sh", "-c", "find /usr/share/nginx/html -type f -name '*.js' -exec sed -i \"s|__VITE_API_URL_PLACEHOLDER__|$VITE_API_URL|g\" {} + && envsubst '$PORT' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
