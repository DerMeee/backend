#!/bin/bash

# Docker deployment script for NestJS + PostgreSQL + Prisma
# Run this script on your VPS after uploading your code

set -e  # Exit on error

echo "🐳 Starting Docker deployment process..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed!${NC}"
    echo "Please install Docker first. See DOCKER_DEPLOYMENT.md"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker compose &> /dev/null; then
    echo -e "${RED}Error: Docker Compose is not installed!${NC}"
    echo "Please install Docker Compose first. See DOCKER_DEPLOYMENT.md"
    exit 1
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠️  .env file not found!${NC}"
    echo "Creating .env from example..."
    if [ -f ".env.docker.example" ]; then
        cp .env.docker.example .env
        echo -e "${YELLOW}Please edit .env file with your actual values before continuing!${NC}"
        echo "Press Enter to continue after editing .env, or Ctrl+C to exit..."
        read
    else
        echo -e "${RED}Error: .env.docker.example not found!${NC}"
        exit 1
    fi
fi

echo -e "${YELLOW}🔨 Building Docker images...${NC}"
docker compose build

echo -e "${YELLOW}🚀 Starting containers...${NC}"
docker compose up -d

echo -e "${YELLOW}⏳ Waiting for services to be ready...${NC}"
sleep 10

echo -e "${YELLOW}📊 Checking container status...${NC}"
docker compose ps

echo -e "${YELLOW}📝 Viewing recent logs...${NC}"
docker compose logs --tail=50

echo -e "${GREEN}✅ Deployment completed!${NC}"
echo ""
echo "Useful commands:"
echo "  - View logs: docker compose logs -f"
echo "  - Check status: docker compose ps"
echo "  - Stop services: docker compose stop"
echo "  - Restart: docker compose restart"
echo ""
echo "Your API should be available at: http://localhost:3000"

