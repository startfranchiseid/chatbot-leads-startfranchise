# Deployment Guide - Chatbot Leads StartFranchise

## Quick Start (VPS)

### 1. Prerequisites
- Docker & Docker Compose installed
- Domain/IP address
- WAHA instance running

### 2. Clone & Configure
```bash
git clone https://github.com/YOUR_USERNAME/chatbot-leads-startfranchise.git
cd chatbot-leads-startfranchise

# Copy and edit environment variables
cp .env.example .env
nano .env
```

### 3. Start Services
```bash
# Build and start all containers
docker-compose up -d --build

# Check logs
docker-compose logs -f app
```

### 4. Access
- **API**: http://your-server:3000
- **Health Check**: http://your-server:3000/health
- **API Docs**: http://your-server:3000/api/docs
- **Metrics**: http://your-server:3000/metrics

---

## Frontend (Admin Dashboard)

### Build for Production
```bash
cd client
npm install
npm run build
```

### Serve with Nginx
Copy `client/dist/` to your Nginx root directory and configure:

```nginx
server {
    listen 80;
    server_name admin.yourdomain.com;
    root /var/www/chatbot-admin;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `DB_HOST` | PostgreSQL host | `localhost` |
| `DB_PASSWORD` | Database password | `secure_password` |
| `REDIS_HOST` | Redis host | `localhost` |
| `WAHA_API_URL` | WAHA API URL | `http://localhost:3001` |
| `WAHA_API_KEY` | WAHA API key | `your_api_key` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | `123456:ABC...` |
| `TELEGRAM_ADMIN_CHAT_ID` | Comma-separated admin IDs | `123456789,987654321` |
| `GOOGLE_SPREADSHEET_ID` | Google Sheets ID | `1abc123...` |

See `.env.example` for full list.

---

## Useful Commands

```bash
# Stop all services
docker-compose down

# Restart app only
docker-compose restart app

# View logs
docker-compose logs -f

# Rebuild after code changes
docker-compose up -d --build app

# Access PostgreSQL
docker-compose exec postgres psql -U chatbot -d chatbot_leads

# Access Redis
docker-compose exec redis redis-cli
```

---

## Webhook Configuration

Configure WAHA to send webhooks to:
```
http://your-server:3000/webhook/waha
```

---

## Troubleshooting

### Container won't start
```bash
docker-compose logs app
```

### Database connection failed
```bash
docker-compose exec postgres pg_isready
```

### Redis connection failed
```bash
docker-compose exec redis redis-cli ping
```
