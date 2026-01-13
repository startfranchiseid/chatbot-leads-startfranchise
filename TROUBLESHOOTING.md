# Troubleshooting Guide - Chatbot Leads StartFranchise

Panduan untuk mendiagnosa dan memperbaiki masalah umum pada sistem.

---

## 🔴 Common Issues

### 1. Server Won't Start

**Symptoms**: Server tidak berjalan, error di console

**Check**:
```bash
# Check logs
docker-compose logs app

# atau
npm run dev 2>&1
```

**Common causes**:
- **Missing .env**: Copy `.env.example` ke `.env`
- **Port in use**: Ganti PORT di .env
- **Redis not connected**: Pastikan Redis running

---

### 2. Database Connection Error

**Symptoms**: `ECONNREFUSED` atau `Connection refused`

**Fix**:
```bash
# Check PostgreSQL status
docker-compose ps postgres

# Restart PostgreSQL
docker-compose restart postgres

# Verify connection string
echo $DATABASE_URL
```

**If using Docker**:
```bash
# Pastikan PostgreSQL healthy
docker-compose logs postgres
```

---

### 3. Redis Connection Error

**Symptoms**: `Redis connection failed` atau lock errors

**Fix**:
```bash
# Check Redis status
docker-compose ps redis
redis-cli ping

# Restart Redis
docker-compose restart redis
```

---

### 4. WAHA Webhook Not Working

**Symptoms**: Messages tidak masuk, webhook tidak dipanggil

**Check**:
1. Pastikan WAHA running dan session aktif
2. Cek webhook URL di WAHA dashboard
3. Verify endpoint accessible:
```bash
curl -X POST http://localhost:3000/api/waha/webhook \
  -H "Content-Type: application/json" \
  -d '{"event": "message", "payload": {}}'
```

**Fix**:
- Pastikan URL webhook benar: `https://YOUR_DOMAIN/api/waha/webhook`
- Check firewall/security groups

---

### 5. Google Sheets Sync Failed

**Symptoms**: Form completed tapi data tidak masuk ke Sheets

**Check**:
```bash
# Check job queue
curl http://localhost:3000/metrics/json
```

**Causes**:
- **Token expired**: Re-run OAuth setup script
- **Wrong spreadsheet ID**: Verify `GOOGLE_SPREADSHEET_ID`
- **Permission denied**: Share spreadsheet dengan service account

**Fix OAuth token**:
```bash
npx tsx scripts/setup-google-oauth.ts
```

---

### 6. Telegram Notifications Not Sending

**Symptoms**: Admin tidak dapat notifikasi escalation

**Check**:
- `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_ADMIN_CHAT_ID` di .env
- Bot sudah start conversation dengan admin

**Verify**:
```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"
```

---

### 7. Duplicate Messages

**Symptoms**: Bot reply multiple times untuk 1 message

**Usual cause**: Redis idempotency expired atau tidak berjalan

**Fix**:
```bash
# Check Redis
redis-cli ping

# Check idempotency TTL (should be 24 hours)
redis-cli KEYS "processed:*"
```

---

### 8. Lead State Stuck

**Symptoms**: Lead tidak berpindah state

**Fix via Admin API**:
```bash
# Get lead details
curl http://localhost:3000/api/admin/leads/{leadId}

# Force state change
curl -X PUT http://localhost:3000/api/admin/leads/{leadId}/state \
  -H "Content-Type: application/json" \
  -d '{"state": "CHOOSE_OPTION"}'
```

---

## 🔍 Debugging Tools

### View Logs
```bash
# Docker
docker-compose logs -f app

# Direct
npm run dev 2>&1 | pino-pretty
```

### Check Metrics
```bash
# Prometheus format
curl http://localhost:3000/metrics

# JSON format
curl http://localhost:3000/metrics/json
```

### Check Health
```bash
# Basic health
curl http://localhost:3000/health

# Full readiness (includes dependencies)
curl http://localhost:3000/ready
```

### Database Queries
```bash
# Connect to PostgreSQL
docker-compose exec postgres psql -U chatbot -d chatbot_leads

# Useful queries
SELECT state, COUNT(*) FROM leads GROUP BY state;
SELECT * FROM leads ORDER BY updated_at DESC LIMIT 10;
```

---

## 📞 Getting Help

1. Check logs: `docker-compose logs -f`
2. Check metrics: `/metrics/json`
3. Check Swagger docs: `/api/docs/swagger`
4. Open GitHub issue dengan log details
