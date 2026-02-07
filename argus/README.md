# Argus — Proactive Memory Assistant v2.6.5

AI-powered WhatsApp assistant that learns from your conversations, detects events, and reminds you at the right moment — while you browse.

## 🚀 Quick Start

### Docker (Recommended — works on Linux / Windows / macOS)

```bash
cd argus
cp .env.example .env          # Fill in GEMINI_API_KEY
docker compose up -d           # Starts 4 containers
docker compose logs -f argus   # View Argus logs
```

### Local Development

```bash
cd argus
npm install
cp .env.example .env           # Fill in GEMINI_API_KEY
npm run dev                    # Hot-reload dev server on :3000
```

## 🐳 Docker Architecture

```
┌─────────────────────────────────────────────────────┐
│                  docker compose                      │
│                                                      │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ postgres │←─│ evolution-api │←─│    argus      │  │
│  │ :5432    │  │ :8080         │  │ :3000         │  │
│  └──────────┘  └──────────────┘  └───────┬───────┘  │
│  ┌──────────┐        ↑                   │          │
│  │  redis   │────────┘                   │ WS+HTTP  │
│  │ :6379    │                            │          │
│  └──────────┘                            ▼          │
│                               Chrome Extension      │
└─────────────────────────────────────────────────────┘
```

| Container | Image | Purpose |
|-----------|-------|---------|
| `argus-server` | Built from `./Dockerfile` | Express server, Gemini AI, SQLite, WebSocket |
| `argus-evolution` | Built from `../evolution-api/Dockerfile` | WhatsApp bridge (Evolution API v2.3) |
| `argus-postgres` | `postgres:16-alpine` | Evolution API database |
| `argus-redis` | `redis:7-alpine` | Evolution API cache |

### Docker Commands

```bash
docker compose up -d               # Start all 4 containers
docker compose up -d --build       # Rebuild + start
docker compose logs -f argus       # Argus logs
docker compose logs -f evolution-api # Evolution logs
docker compose down                # Stop
docker compose down -v             # Stop + delete all data
docker compose ps                  # Status
```

## 📁 Project Structure

```
argus/
├── src/
│   ├── server.ts        # Express + WebSocket server
│   ├── db.ts            # SQLite + FTS5 database
│   ├── gemini.ts        # Gemini AI — extraction, popup blueprints, chat
│   ├── ingestion.ts     # WhatsApp message processing pipeline
│   ├── matcher.ts       # URL pattern matching for context triggers
│   ├── scheduler.ts     # Time-based reminders + snooze
│   ├── evolution-db.ts  # Direct PostgreSQL read for message history
│   └── types.ts         # Zod schemas + config parser
├── extension/           # Chrome Extension (Manifest V3)
│   ├── manifest.json    # <all_urls> content scripts
│   ├── background.js    # WebSocket, API calls, context checks
│   ├── content.js       # Popup overlays (8 types), DOM form watcher
│   ├── sidepanel.html/js # AI Chat sidebar
│   ├── popup.html/js    # Extension popup with stats
│   └── icons/           # Extension icons
├── tests/               # Vitest tests
├── data/                # SQLite database (auto-created)
├── Dockerfile           # Multi-stage Node 22 Alpine
├── docker-compose.yml   # Full stack (4 containers)
└── .env.example         # Environment template
```

## 🔧 Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Build TypeScript → `dist/` |
| `npm start` | Run production server |
| `npm test` | Run tests (~2s, Vitest) |
| `npm run lint` | Lint code (ESLint, cached) |
| `npm run format` | Format code (Prettier) |
| `npm run typecheck` | Type-check without emitting |

## 🔌 Chrome Extension Setup

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `extension/` folder
4. (For local `file://` testing) → Enable **Allow access to file URLs**

## 📡 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/stats` | GET | Statistics |
| `/api/events` | GET | List events (filter by `?status=`) |
| `/api/events/:id` | PATCH | Update event fields |
| `/api/events/:id` | DELETE | Delete event |
| `/api/events/:id/set-reminder` | POST | Schedule event |
| `/api/events/:id/snooze` | POST | Snooze for X minutes |
| `/api/events/:id/ignore` | POST | Ignore event |
| `/api/events/:id/complete` | POST | Mark done |
| `/api/events/:id/dismiss` | POST | Dismiss notification |
| `/api/events/:id/acknowledge` | POST | Acknowledge reminder |
| `/api/events/:id/confirm-update` | POST | Confirm pending update |
| `/api/events/day/:timestamp` | GET | Get all events for a day |
| `/api/context-check` | POST | Check URL for matching events |
| `/api/form-check` | POST | Check form field mismatch |
| `/api/extract-context` | POST | Extract context from URL |
| `/api/chat` | POST | AI Chat — context-aware conversation |
| `/api/webhook/whatsapp` | POST | Evolution API webhook |
| `/ws` | WebSocket | Real-time notifications |

## 🎯 How It Works

```
WhatsApp Message → Evolution API → Webhook → Argus Server
                                                  │
                                         Gemini AI extracts
                                        events/tasks/reminders
                                                  │
                                        SQLite FTS5 stores &
                                         indexes everything
                                                  │
                                   ┌──────────────┼──────────────┐
                                   │              │              │
                              WebSocket      URL Match      DOM Watch
                              (new event)   (context)      (form field)
                                   │              │              │
                                   └──────────────┼──────────────┘
                                                  │
                                          Chrome Extension
                                         shows popup overlay
```

## ✅ Working Scenarios

### 1. Travel Recommendations (Goa Cashews)
```
💬 "Rahul recommended cashews at Zantye's in Goa"
🌐 User visits goatourism.com
🔔 Popup: "Rahul's Recommendation — Remember the cashews at Zantye's?"
```

### 2. Insurance Accuracy (Form Mismatch)
```
💬 User owns Honda Civic 2018 (from WhatsApp chats)
🌐 User visits ACKO and types "Honda Civic 2022"
🔔 Popup: "Hold on — you own a Honda Civic 2018! You might be overpaying!"
✏️ "Fix It" button auto-fills the correct value
```

### 3. Gift Intent (E-commerce)
```
💬 "Need to buy makeup for sis birthday"
🌐 User visits Nykaa
🔔 Popup: "Sale going on! You mentioned wanting makeup for your sister"
```

### 4. Subscription Cancel (Netflix)
```
💬 "Want to cancel my Netflix this week"
🌐 User visits netflix.com
🔔 Popup: "You planned to cancel your Netflix subscription"
```

### 5. Calendar Conflict Detection
```
💬 "Meeting tomorrow at 5pm"
💬 "Call with John tomorrow at 5pm"
🔔 Popup: "You might be double-booked" + View My Day timeline
```

## 🔔 Popup Types (8)

| Type | Icon | Trigger |
|------|------|---------|
| `event_discovery` | 📅 | New event detected from WhatsApp |
| `event_reminder` | ⏰ | Time-based (24h, 1h, 15min before) |
| `context_reminder` | 🎯 | URL matches event context |
| `conflict_warning` | 🗓️ | Overlapping events detected |
| `insight_card` | 💡 | Suggestions from conversations |
| `snooze_reminder` | 💤 | Snoozed event fires again |
| `update_confirm` | 📝 | Confirm event modification |
| `form_mismatch` | ⚠️ | Form input doesn't match memory |

## ⚙️ Configuration

Copy `.env.example` to `.env` and set:

```bash
# Required
GEMINI_API_KEY=your_key_here

# Optional (defaults work for Docker)
GEMINI_MODEL=gemini-3-flash-preview
EVOLUTION_API_KEY=rmd_evolution_api_key_12345
EVOLUTION_INSTANCE_NAME=arguas
```

## 📊 Performance

| Metric | Value |
|--------|-------|
| Message ingestion | <500ms |
| Context check | <800ms |
| Database query | <10ms |
| Memory usage | <200MB |
| 50k messages | ~40MB storage |
| Test suite | ~2s |

## 🧪 Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage
```

## 📝 License

Private — All rights reserved
