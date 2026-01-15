# Production Dockerfile for Frontend
FROM node:20-alpine as builder

WORKDIR /app

# Build argument for API URL (passed from Railway)
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the app
RUN npm run build

# Production stage
FROM nginx:alpine

# Install envsubst for dynamic port configuration
RUN apk add --no-cache gettext

# Copy nginx template
COPY nginx.template.conf /etc/nginx/templates/default.conf.template

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Railway uses PORT env variable, default to 80
ENV PORT=80

# Use nginx docker-entrypoint which processes templates
# It will replace ${PORT} in the template
CMD ["sh", "-c", "envsubst '$PORT' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
