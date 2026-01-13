#!/bin/bash
# ==============================================
# Chatbot Leads StartFranchise - Quick Deploy
# ==============================================
# Usage: curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/chatbot-leads-startfranchise/main/deploy.sh | bash
# Or: bash deploy.sh

set -e

echo "🚀 Starting Chatbot Leads StartFranchise Deployment..."
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker not found. Installing...${NC}"
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
    echo -e "${GREEN}Docker installed!${NC}"
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo -e "${YELLOW}Docker Compose not found. Installing...${NC}"
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    echo -e "${GREEN}Docker Compose installed!${NC}"
fi

# Create project directory
PROJECT_DIR="$HOME/chatbot-leads"
mkdir -p $PROJECT_DIR
cd $PROJECT_DIR

echo ""
echo -e "${GREEN}📂 Working directory: $PROJECT_DIR${NC}"
echo ""

# Clone or update repository
if [ -d ".git" ]; then
    echo "Updating existing repository..."
    git pull origin main
else
    echo "Cloning repository..."
    git clone https://github.com/startfranchiseid/chatbot-leads-startfranchise.git .
fi

# Create .env if not exists
if [ ! -f ".env" ]; then
    echo ""
    echo -e "${YELLOW}⚙️  Creating .env file...${NC}"
    cp .env.example .env
    
    echo ""
    echo -e "${RED}⚠️  IMPORTANT: Please edit .env file with your credentials!${NC}"
    echo ""
    echo "Required settings to configure:"
    echo "  - WAHA_API_URL (your WAHA instance URL)"
    echo "  - WAHA_API_KEY (your WAHA API key)"
    echo "  - GOOGLE_* (Google Sheets credentials)"
    echo "  - TELEGRAM_* (Telegram bot credentials)"
    echo ""
    echo "Run: nano .env"
    echo ""
    read -p "Press Enter after you've configured .env, or Ctrl+C to exit..."
fi

# Build and start
echo ""
echo -e "${GREEN}🔨 Building and starting services...${NC}"
docker-compose down 2>/dev/null || true
docker-compose up -d --build

# Wait for services
echo ""
echo "⏳ Waiting for services to start..."
sleep 10

# Health check
echo ""
echo -e "${GREEN}🏥 Checking service health...${NC}"

if curl -s http://localhost:3000/health | grep -q "ok"; then
    echo -e "${GREEN}✅ API is healthy!${NC}"
else
    echo -e "${RED}❌ API health check failed. Check logs with: docker-compose logs app${NC}"
fi

# Show status
echo ""
echo "📊 Container Status:"
docker-compose ps

echo ""
echo "=========================================="
echo -e "${GREEN}🎉 Deployment Complete!${NC}"
echo "=========================================="
echo ""
echo "🌐 API URL: http://$(hostname -I | awk '{print $1}'):3000"
echo "📚 API Docs: http://$(hostname -I | awk '{print $1}'):3000/api/docs"
echo "❤️ Health: http://$(hostname -I | awk '{print $1}'):3000/health"
echo ""
echo "📝 Useful Commands:"
echo "  View logs:     docker-compose logs -f"
echo "  Restart:       docker-compose restart"
echo "  Stop:          docker-compose down"
echo "  Rebuild:       docker-compose up -d --build"
echo ""
echo "🔧 Configure WAHA webhook to:"
echo "  http://YOUR_SERVER_IP:3000/webhook/waha"
echo ""
