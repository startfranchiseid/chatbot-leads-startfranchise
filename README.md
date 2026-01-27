# Chatbot Leads Management System (StartFranchise)

A high-performance, Full-Stack Chatbot & Leads Management System designed to handle inbound leads from WhatsApp (via WAHA) and Telegram. It features a robust state machine for lead qualification, Google Sheets synchronization, and a modern Admin Dashboard.

## 🚀 Features

-   **Multi-Channel Support**:  
    -   **WhatsApp**: Integration via [WAHA](https://waha.devlike.pro/) (WhatsApp HTTP API). Supports multiple sessions/numbers.
    -   **Telegram**: Direct bot integration.
-   **Lead Management**:
    -   **State Machine**: Tracks lead progress (New -> Form In Progress -> Completed).
    -   **Idempotency**: Prevents duplicate processing of messages.
    -   **Race Condition Handling**: Uses Redis distributed locks to handle simultaneous messages safeley.
-   **Admin Dashboard**:
    -   React + Vite + TailwindCSS modern UI.
    -   Real-time lead monitoring.
    -   WAHA Session Management (QR Scan, massive status checks).
    -   Message History & Logs.
-   **Integration**:
    -   **Google Sheets**: Auto-syncs completed leads to a spreadsheet.
    -   **Webhook System**: Captures all incoming events for audit trails.

---

## 🛠️ Tech Stack

### **Backend (`/src`)**
-   **Runtime**: Node.js (TypeScript)
-   **Framework**: [Fastify](https://fastify.dev/) (High performance)
-   **Database**: PostgreSQL (Primary Data Store)
-   **Cache/Locks**: Redis (via `ioredis`)
-   **Queue**: BullMQ (Background jobs for syncing)
-   **Logging**: Pino
-   **Infrastructure**: Docker

### **Frontend (`/client`)**
-   **Framework**: React (Vite)
-   **Styling**: TailwindCSS
-   **Data Fetching**: SWR
-   **Router**: Wouter

---

## 📂 Project Structure

```
├── client/                 # Frontend React Application
│   ├── src/
│   │   ├── pages/          # Admin Dashboard Pages
│   │   ├── components/     # Reusable UI Components
│   │   └── lib/            # API Helpers
│   └── Dockerfile          # Frontend Docker Config
├── src/                    # Backend Source Code
│   ├── modules/            # Feature modules
│   │   ├── inbound/        # Webhook Handlers (WAHA/Telegram)
│   │   ├── lead/           # Business Logic (State Machine)
│   │   ├── waha/           # WAHA Session Management
│   │   └── admin/          # Admin API Endpoints
│   ├── infra/              # Infrastructure (DB, Redis, Logger)
│   └── jobs/               # Background Workers (Sheet Sync)
├── scripts/                # Utility scripts (OAuth setup, Tests)
├── docker-compose.yml      # Main Docker Orchestration
├── Dockerfile              # Backend Docker Config
└── VPS_DOCKER_DEPLOYMENT.md # Detailed VPS Guide
```

---

## ⚙️ Configuration (.env)

Duplicate `.env.example` to `.env` and configure:

```ini
# Application
PORT=3000
NODE_ENV=development

# Database (PostgreSQL)
DATABASE_URL=postgresql://user:pass@host:5432/dbname
DB_HOST=localhost # Or service name 'db' in docker
DB_PORT=5432
DB_NAME=startfranchise
DB_USER=admin
DB_PASSWORD=secret

# Redis
REDIS_URL=redis://host:6379
REDIS_HOST=localhost # Or service name 'redis' in docker
REDIS_PORT=6379

# WAHA (WhatsApp API)
WAHA_API_URL=http://your-waha-instance:3000
WAHA_SESSION_NAME=default
WAHA_API_KEY=your-api-key

# Google Sheets (OAuth2)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
GOOGLE_SPREADSHEET_ID=...
```

---

## 🚀 Deployment Guide (VPS + Docker)

Since ports `3000` and `5173` might be busy, we use custom ports **4000** (API) and **5174** (Dashboard).

1.  **Configure VPS Environment**:
    Create a `.env` file on your VPS with correct values.
    *   **Hint**: Use `host.docker.internal` to access services running on the host machine from inside Docker containers (if `network_mode: host` is not used).

2.  **Run Docker Compose**:
    ```bash
    docker-compose up -d --build
    ```

3.  **Access:**
    -   **Dashboard**: `http://YOUR_VPS_IP:5174`
    -   **API**: `http://YOUR_VPS_IP:4000`

---

## 🔧 Troubleshooting & Known Issues

1.  **Database Migration (Column Missing: alt_id)**:
    -   The app auto-migrates schemas on startup (`src/infra/db.ts`).
    -   **Critical**: The column `alt_id` in `leads` table replaces the old `whatsapp_lid`. 
    -   If you see `error: column "alt_id" does not exist`, it means the **database migration did not run**. Ensure you have pulled the latest code and rebuilt the container.

2.  **WAHA Connection Refused**:
    -   If the bot processes messages (State accumulates) but doesn't reply:
    -   Check `WAHA_API_URL` in `.env`.
    -   If WAHA is on the host, use `http://host.docker.internal:3000` instead of `localhost` or public IP.

3.  **Ports "Address already in use"**:
    -   Use `lsof -i :4000` to find zombie processes and kill them with `kill -9 <PID>`.

---

## 📝 Developer Handover Notes

-   **State Machine**: Logic is in `src/modules/lead/lead.state.ts`. Modifications to flow should happen there.
-   **WAHA Controller**: `src/modules/inbound/waha.controller.ts` handles the raw webhook payload.
-   **Syncing**: `src/jobs/sync-to-sheets.job.ts` handles the background sync to Google Sheets. It runs every 1 minute.
-   **Authentication**: The admin dashboard currently has **no authentication** layer. It is intended for internal use on a secured network or VPN.
