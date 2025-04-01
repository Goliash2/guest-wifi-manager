# Stage 1: Build the Vue application
FROM node:20-alpine as build-stage

WORKDIR /app

# Copy package.json and lock file
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the application
# Ensure VITE_API_BASE_URL is set appropriately during build or use runtime config
ARG VITE_API_BASE_URL=/api # Default value, can be overridden
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build

# Stage 2: Serve the built application using Nginx
FROM nginx:stable-alpine

# Copy built files from the build stage
COPY --from=build-stage /app/dist /usr/share/nginx/html

# Copy custom Nginx configuration (optional, but good for SPA routing)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]