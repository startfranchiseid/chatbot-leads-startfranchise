# 📋 Project Milestone - Chatbot Leads StartFranchise

> **Last Updated:** 12 Januari 2026  
> **Status:** Development Complete - Ready for Production Testing

---

## 🎯 Project Overview

Sistem inbound lead management via WhatsApp & Telegram dengan integrasi Google Sheets untuk StartFranchise Indonesia.

### Tech Stack
- **Runtime:** Node.js (LTS)
- **Framework:** Fastify
- **Database:** PostgreSQL
- **Cache & Lock:** Redis
- **Queue:** BullMQ
- **WhatsApp:** WAHA API
- **Spreadsheet:** Google Sheets API (OAuth2)
- **Notification:** Telegram Bot API

---

## ✅ Task yang Sudah Selesai

### 1. Infrastructure Setup
- [x] PostgreSQL database schema (leads, lead_interactions, lead_form_data)
- [x] Redis connection dengan retry strategy
- [x] BullMQ queue setup (sheets-sync, telegram-notify)
- [x] Fastify server dengan rate limiting
- [x] Pino logger untuk observability

### 2. Core Message Handling
- [x] WAHA webhook endpoint (`/webhook`)
- [x] Message parser untuk WhatsApp payload
- [x] Filter pesan dari bot sendiri (`fromMe`)
- [x] Filter group chat (`@g.us`)
- [x] Filter broadcast/status messages
- [x] Normalisasi user ID (LID format dan phone format)

### 3. Anti-Spam & Idempotency
- [x] Idempotency check via Redis (24 jam TTL)
- [x] Per-user distributed locking
- [x] User cooldown system (mencegah spam beruntun)
- [x] Pending message queue untuk debouncing

### 4. Lead State Machine
- [x] State definitions (NEW, CHOOSE_OPTION, FORM_SENT, FORM_IN_PROGRESS, FORM_COMPLETED, MANUAL_INTERVENTION, PARTNERSHIP)
- [x] Valid state transitions
- [x] State persistence di PostgreSQL
- [x] Warning counter untuk escalation

### 5. Form Handling
- [x] Form parsing dari free-text messages
- [x] Form validation (sumber, bisnis, budget, rencana)
- [x] Partial form data storage
- [x] Missing fields detection

### 6. Google Sheets Integration
- [x] OAuth2 authentication setup
- [x] Refresh token flow
- [x] Append data ke spreadsheet
- [x] Phone number cleaning (remove @c.us, @lid, etc.)
- [x] Indonesian date formatting (DD MMMM YYYY)
- [x] Header auto-detection

### 7. Bot Responses
- [x] Welcome message
- [x] Form request message
- [x] Form received confirmation
- [x] Partnership message
- [x] Question received message
- [x] Invalid option message
- [x] Escalation notice

### 8. Security & Repository
- [x] Environment variables untuk secrets
- [x] .gitignore untuk .env dan node_modules
- [x] Scripts folder excluded dari git (secrets protection)
- [x] GitHub push protection resolved

---

## 🔄 Task yang Sedang Berlangsung

### Testing & Validation
- [ ] End-to-end testing dengan user nyata
- [ ] Load testing untuk concurrent messages
- [ ] Error scenario testing

---

## 📝 Task yang Belum Dilakukan

### 1. Telegram Bot Integration
- [x] Telegram webhook controller
- [x] Telegram message parser
- [x] Admin notification via Telegram
- [x] Escalation alerts

### 2. Admin Dashboard
- [x] Lead list endpoint
- [x] Manual state change endpoint
- [x] Analytics endpoint

### 3. Production Deployment
- [x] Dockerfile creation
- [x] Docker Compose setup
- [ ] Environment configuration untuk production
- [ ] SSL/HTTPS setup
- [ ] Domain setup untuk webhook

### 4. Monitoring & Alerting
- [x] Health check endpoint
- [x] Metrics endpoint (Prometheus compatible)
- [x] Error alerting system (via Telegram)
- [x] Queue monitoring dashboard

### 5. Documentation
- [x] API documentation (Swagger/OpenAPI)
- [x] Deployment guide
- [x] Troubleshooting guide

---

## 🧪 Testing Checklist

### Unit Testing (Vitest)
- [x] `message.parser.ts` - Parse berbagai format pesan (26 tests)
- [x] `lead.state.ts` - Valid/invalid state transitions (36 tests)
- [x] `lead.validator.ts` - Form validation rules (22 tests)
- [x] `normalize-user.ts` - User ID normalization (22 tests)

### Integration Testing (Mocked)
- [x] Idempotency service - duplicate detection (11 tests)
- [x] Redis operations - locks, cooldown, messaging (15 tests)
- [ ] WAHA webhook → Message Handler → Database
- [ ] Form submission → Google Sheets sync
- [ ] Escalation → Telegram notification

### End-to-End Testing
- [x] New user flow: Welcome → Option → Form → Completed (13 tests)
- [x] Returning user recognition (EXISTING state)
- [x] Invalid input handling (3x warning → escalation)
- [x] Concurrent message handling (no race condition)
- [x] Group chat ignored
- [x] Broadcast ignored

### Performance Testing
- [x] Response time < 100ms target (Median 70ms)
- [x] 100 concurrent users simulation (Rate limited correctly)
- [x] Redis connection pool stress test
- [x] Database connection pool stress test

---

## ⚠️ Production Use Cases & Edge Cases

### 1. Normal User Flow
```
User kirim pesan pertama kali
→ Bot reply: Welcome message + menu
→ User pilih opsi 1 (mencari franchise)
→ Bot reply: Form request
→ User kirim form lengkap
→ Bot reply: Konfirmasi
→ Data masuk ke Google Sheets
→ Status: FORM_COMPLETED
```

### 2. Partial Form Submission
```
User kirim form tidak lengkap
→ Bot reply: Missing fields message
→ User kirim ulang dengan lengkap
→ Bot reply: Konfirmasi
→ Data masuk ke Google Sheets
```

### 3. Invalid Input Handling
```
User kirim 3x input tidak valid
→ Warning counter increment
→ Setelah 3x: State → MANUAL_INTERVENTION
→ Bot reply: Escalation notice
→ Admin dapat notifikasi via Telegram
→ Bot berhenti auto-reply ke user ini
```

### 4. Spam Prevention
```
User kirim 10 pesan dalam 1 detik
→ Hanya 1 pesan diproses (cooldown)
→ Sisanya di-batch, diproses terakhir
→ Bot reply hanya 1x (tidak spam)
```

### 5. Duplicate Webhook Prevention
```
WAHA kirim webhook 2x (retry)
→ Message ID sudah ada di Redis
→ Pesan kedua di-DROP
→ Tidak ada duplicate processing
```

### 6. Race Condition Prevention
```
2 request masuk bersamaan untuk 1 user
→ Request pertama acquire lock
→ Request kedua wait (dengan retry)
→ Processing sequential
→ State integrity terjaga
```

### 7. Group Chat Handling
```
Bot di-add ke group WhatsApp
→ Pesan dari group terdeteksi (@g.us)
→ Pesan IGNORED
→ Bot TIDAK reply ke group
→ Tidak ada data tersimpan
```

### 8. Broadcast/Status Handling
```
User post status WhatsApp
→ Webhook masuk dengan @broadcast
→ Pesan IGNORED
→ Bot tidak respond
```

### 9. Existing Contact (Pre-registered)
```
Nomor lama (sudah ada di database dengan status EXISTING)
→ User kirim pesan
→ Bot TIDAK auto-reply
→ Manual follow-up oleh tim sales
```

### 10. Google Sheets API Down
```
Form completed, API Sheets gagal
→ Job masuk ke retry queue
→ Exponential backoff (5 attempts)
→ Jika gagal terus: Log untuk audit
→ Data tetap aman di PostgreSQL
```

### 11. Redis Down (Temporary)
```
Redis tidak available sementara
→ Lock acquisition gagal
→ Message diproses dengan fallback
→ Idempotency check skip (log warning)
→ Setelah Redis up: Normal operation
```

### 12. WhatsApp LID Format
```
User dengan format baru WhatsApp (LID)
→ ID: 123456789:12@lid
→ Parser extract dengan benar
→ Stored as consistent user_id
→ State tracking normal
```

### 13. Multiple Sessions
```
User punya 2 device WhatsApp
→ Kirim pesan dari device berbeda
→ User ID sama (normalized)
→ State dan conversation continuous
```

### 14. Long Running Conversation
```
User mulai chat hari ini
→ Lanjutkan besok
→ State loaded dari database
→ Conversation resume dari state terakhir
```

### 15. Admin Manual Intervention
```
Lead stuck di MANUAL_INTERVENTION
→ Admin reset state via endpoint
→ User dapat pesan baru dari bot
→ Flow restart dari state yang di-set admin
```

---

## 🔧 Environment Variables Required

```env
# Server
PORT=3000

# PostgreSQL
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# WAHA (WhatsApp)
WAHA_API_URL=http://localhost:3001
WAHA_API_KEY=your-api-key
WAHA_SESSION_NAME=default

# Google Sheets (OAuth2)
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REFRESH_TOKEN=xxx
GOOGLE_SPREADSHEET_ID=xxx
GOOGLE_SHEET_NAME=Leads

# Telegram (Optional)
TELEGRAM_BOT_TOKEN=
TELEGRAM_ADMIN_CHAT_ID=

# Lock Settings
LOCK_TTL_SECONDS=10
USER_COOLDOWN_MS=5000
```

---

## 📊 Success Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Response Time | < 100ms | ✅ Achieved |
| Duplicate Prevention | 100% | ✅ Achieved |
| Race Condition Prevention | 100% | ✅ Achieved |
| Form Completion Rate | > 60% | 📊 Need Data |
| Escalation Rate | < 10% | 📊 Need Data |
| Sheets Sync Success | > 99% | ✅ Tested |

---

## 🚀 Next Steps

1. **Testing Phase** - Run end-to-end tests dengan user nyata
2. **Telegram Integration** - Complete admin notification system
3. **Deployment** - Setup Docker dan production environment
4. **Monitoring** - Add health checks dan alerting
5. **Documentation** - Complete API docs dan deployment guide

---

## 📁 File Structure

```
src/
├── app.ts                    # Fastify bootstrap
├── server.ts                 # HTTP server
├── modules/
│   ├── inbound/
│   │   ├── waha.controller.ts    # WAHA webhook handler
│   │   └── inbound.service.ts    # Inbound processing
│   ├── lead/
│   │   ├── lead.service.ts       # Lead CRUD operations
│   │   ├── lead.state.ts         # State machine logic
│   │   └── lead.validator.ts     # Form validation
│   ├── message/
│   │   ├── message.parser.ts     # Parse WAHA payload
│   │   ├── message.handler.ts    # Main message processing
│   │   └── idempotency.ts        # Duplicate prevention
│   ├── warning/
│   │   └── warning.service.ts    # Warning counter
│   └── integration/
│       ├── sheets.worker.ts      # Google Sheets sync
│       └── telegram.worker.ts    # Telegram notifications
├── infra/
│   ├── db.ts                     # PostgreSQL client
│   ├── redis.ts                  # Redis + locks
│   ├── queue.ts                  # BullMQ
│   └── logger.ts                 # Pino logger
├── jobs/
│   └── sync-to-sheets.job.ts     # Background job runner
├── utils/
│   ├── normalize-user.ts         # User ID normalization
│   └── sleep.ts                  # Utility function
└── types/
    └── lead.ts                   # TypeScript types
```

---

*Document generated automatically - Last sync: 12 Januari 2026*
