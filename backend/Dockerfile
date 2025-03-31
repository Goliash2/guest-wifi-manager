# Use an official Node.js runtime as a parent image
FROM node:20-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (or yarn.lock)
COPY package*.json ./

# Install app dependencies
# Use --omit=dev in production if you have devDependencies you don't need
RUN npm install --omit=dev

# Bundle app source
COPY . .

# Make port 3000 available to the world outside this container (optional if only accessed via docker network)
# EXPOSE 3000

# Define environment variables (defaults, can be overridden in docker-compose)
ENV NODE_ENV=production
ENV PORT=3000
# ENV JWT_SECRET= # Should be set in docker-compose or secrets
# ENV DB_URL= # Should be set in docker-compose
# ENV SMTP_HOST= # Should be set in docker-compose
# ... other ENV vars

# Run server.js when the container launches
CMD [ "node", "server.js" ]