# Deployment Guide - Chatbot Leads StartFranchise

Panduan lengkap untuk men-deploy sistem Chatbot Leads ke production.

---

## 📋 Prerequisites

### Required Services
- **Node.js** v20+ (LTS)
- **PostgreSQL** v15+
- **Redis** v7+
- **WAHA** (WhatsApp HTTP API)
- **Telegram Bot** (opsional)

### Domain & SSL
- Domain untuk webhook (contoh: `api.startfranchise.id`)
- SSL certificate (Let's Encrypt recommended)

---

## 🚀 Deployment Options

### Option 1: Docker Compose (Recommended)

```bash
# Clone repository
git clone https://github.com/startfranchiseid/chatbot-leads-startfranchise.git
cd chatbot-leads-startfranchise

# Copy environment file
cp .env.example .env

# Edit environment variables
nano .env

# Start services
docker-compose up -d

# Check logs
docker-compose logs -f app
```

### Option 2: Manual Deployment

```bash
# Install dependencies
npm ci --only=production

# Build TypeScript
npm run build

# Start server
NODE_ENV=production node dist/server.js
```

---

## ⚙️ Environment Variables

### Required

```env
# Server
PORT=3000
NODE_ENV=production

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/chatbot_leads

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# WAHA (WhatsApp)
WAHA_API_URL=http://waha:3001
WAHA_API_KEY=your_waha_api_key
WAHA_SESSION_NAME=default
```

### Google Sheets (OAuth2)

```env
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REFRESH_TOKEN=xxx
GOOGLE_SPREADSHEET_ID=your_spreadsheet_id
GOOGLE_SHEET_NAME=Informasi Client
```

### Telegram (Optional)

```env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_ADMIN_CHAT_ID=your_chat_id
```

---

## 🔒 SSL/HTTPS Setup

### Using Nginx as Reverse Proxy

```nginx
server {
    listen 443 ssl;
    server_name api.startfranchise.id;

    ssl_certificate /etc/letsencrypt/live/api.startfranchise.id/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.startfranchise.id/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Using Certbot for SSL

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Generate certificate
sudo certbot --nginx -d api.startfranchise.id
```

---

## 📡 Webhook Setup

### WAHA Webhook
Configure WAHA to send webhooks to:
```
https://api.startfranchise.id/api/waha/webhook
```

### Telegram Webhook
```bash
# Set Telegram webhook
curl -X POST https://api.startfranchise.id/api/telegram/set-webhook \
  -H "Content-Type: application/json" \
  -d '{"url": "https://api.startfranchise.id"}'
```

---

## 🔍 Health Checks

```bash
# Basic health check
curl https://api.startfranchise.id/health

# Readiness check (includes dependencies)
curl https://api.startfranchise.id/ready

# Prometheus metrics
curl https://api.startfranchise.id/metrics
```

---

## 📊 Monitoring

### Prometheus Metrics
Add ke `prometheus.yml`:
```yaml
scrape_configs:
  - job_name: 'chatbot-leads'
    static_configs:
      - targets: ['api.startfranchise.id:443']
    scheme: https
```

### Available Endpoints
- `/health` - Server health
- `/ready` - Service readiness
- `/metrics` - Prometheus metrics
- `/api/admin/analytics` - Dashboard stats

---

## 🔄 Updates & Maintenance

### Rolling Update with Docker

```bash
# Pull latest changes
git pull origin main

# Rebuild and restart
docker-compose build app
docker-compose up -d app

# Verify
docker-compose logs -f app
```

### Database Migrations
Database schema auto-initializes on startup. No manual migrations needed.

---

## 🆘 Support

- **Docs**: `/api/docs/swagger`
- **Status**: `/health`
- **Logs**: `docker-compose logs -f`
