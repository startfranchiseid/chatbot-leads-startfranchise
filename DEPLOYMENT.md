# 🚀 Panduan Deploy Chatbot Leads StartFranchise

Dokumen ini berisi panduan lengkap untuk deploy chatbot ke VPS/Server.

---

## 📋 Persyaratan

### Server Requirements
- **OS**: Ubuntu 20.04+ / Debian 11+ (recommended)
- **RAM**: Minimum 2GB
- **Storage**: Minimum 10GB
- **Port**: 3000 (API), 5432 (PostgreSQL), 6379 (Redis)

### Services Required
- **WAHA** (WhatsApp HTTP API) - sudah running
- **Telegram Bot** - sudah dibuat via @BotFather

---

## 🚀 Quick Deploy (One-Liner)

SSH ke server Anda dan jalankan:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/startfranchiseid/chatbot-leads-startfranchise/main/deploy.sh)
```

Script ini akan:
1. Install Docker & Docker Compose (jika belum ada)
2. Clone repository
3. Generate .env template
4. Build & start semua services

---

## 📝 Manual Deploy (Step-by-Step)

### Step 1: Install Docker

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh

# Add user to docker group
sudo usermod -aG docker $USER

# Logout and login again, then verify
docker --version
```

### Step 2: Install Docker Compose

```bash
# Download Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose

# Make executable
sudo chmod +x /usr/local/bin/docker-compose

# Verify
docker-compose --version
```

### Step 3: Clone Repository

```bash
# Create project directory
mkdir -p ~/chatbot-leads
cd ~/chatbot-leads

# Clone repo
git clone https://github.com/startfranchiseid/chatbot-leads-startfranchise.git .
```

### Step 4: Configure Environment

```bash
# Copy example config
cp .env.example .env

# Edit with your values
nano .env
```

**Isi file .env:**

```env
# Server
PORT=3000
NODE_ENV=production

# Database (akan dibuatkan oleh Docker)
DB_HOST=postgres
DB_PORT=5432
DB_NAME=chatbot_leads
DB_USER=chatbot
DB_PASSWORD=GANTI_DENGAN_PASSWORD_AMAN

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# WAHA - ISI DENGAN DATA ANDA
WAHA_API_URL=http://IP_WAHA_ANDA:3001
WAHA_SESSION_NAME=default
WAHA_API_KEY=API_KEY_WAHA_ANDA

# Google Sheets - ISI DENGAN DATA ANDA
GOOGLE_SPREADSHEET_ID=ID_SPREADSHEET_ANDA
GOOGLE_SHEET_NAME=Informasi Client
GOOGLE_CLIENT_ID=CLIENT_ID_ANDA.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=SECRET_ANDA
GOOGLE_REFRESH_TOKEN=TOKEN_ANDA

# Telegram - ISI DENGAN DATA ANDA
TELEGRAM_BOT_TOKEN=123456:ABC-xxxxx
TELEGRAM_ADMIN_CHAT_ID=123456789,987654321
```

### Step 5: Build & Start

```bash
# Build and start all services
docker-compose up -d --build

# Check status
docker-compose ps

# View logs
docker-compose logs -f app
```

### Step 6: Configure WAHA Webhook

Buka WAHA dashboard dan set webhook URL:

```
http://IP_SERVER_ANDA:3000/webhook/waha
```

Events yang perlu diaktifkan:
- `message`
- `message.any`

---

## 🖥️ Deploy Frontend (Admin Dashboard)

### Option A: Serve via Nginx

```bash
# Di local machine, build frontend
cd client
npm install
npm run build

# Copy dist folder ke server
scp -r dist/ user@server:/var/www/chatbot-admin/
```

Nginx config:

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
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Option B: Serve via Docker

Tambahkan service ke `docker-compose.yml`:

```yaml
  frontend:
    image: nginx:alpine
    container_name: chatbot-admin
    volumes:
      - ./client/dist:/usr/share/nginx/html:ro
    ports:
      - "5173:80"
    networks:
      - chatbot-network
```

---

## 🔧 Perintah Berguna

```bash
# Lihat logs
docker-compose logs -f

# Lihat logs app saja
docker-compose logs -f app

# Restart semua services
docker-compose restart

# Restart app saja
docker-compose restart app

# Stop semua
docker-compose down

# Rebuild dan start ulang
docker-compose up -d --build

# Masuk ke PostgreSQL
docker-compose exec postgres psql -U chatbot -d chatbot_leads

# Masuk ke Redis
docker-compose exec redis redis-cli

# Lihat resource usage
docker stats
```

---

## 🔒 Security (Produksi)

### 1. Firewall (UFW)

```bash
# Enable UFW
sudo ufw enable

# Allow SSH
sudo ufw allow 22

# Allow API port
sudo ufw allow 3000

# Allow Frontend port
sudo ufw allow 80
sudo ufw allow 443
```

### 2. SSL dengan Let's Encrypt

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Generate SSL
sudo certbot --nginx -d api.yourdomain.com
```

### 3. Reverse Proxy dengan Nginx

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name api.yourdomain.com;
    
    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 🐛 Troubleshooting

### Container tidak start
```bash
docker-compose logs app
```

### Database error
```bash
# Check PostgreSQL
docker-compose exec postgres pg_isready

# View PostgreSQL logs
docker-compose logs postgres
```

### Redis error
```bash
# Check Redis
docker-compose exec redis redis-cli ping
```

### Port already in use
```bash
# Find process using port 3000
sudo lsof -i :3000

# Kill process
sudo kill -9 PID
```

### Reset database
```bash
# Stop services
docker-compose down

# Remove volumes
docker volume rm chatbot-leads-startfranchise_postgres_data
docker volume rm chatbot-leads-startfranchise_redis_data

# Restart
docker-compose up -d --build
```

---

## 📞 Support

Jika butuh bantuan, hubungi:
- GitHub Issues: [Repository Issues](https://github.com/startfranchiseid/chatbot-leads-startfranchise/issues)
- Instagram: [@startfranchise.id](https://instagram.com/startfranchise.id)
