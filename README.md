# Argus — WhatsApp Memory Assistant

> AI-powered proactive memory assistant that learns from your WhatsApp conversations and reminds you about relevant events while browsing.

[![License](https://img.shields.io/badge/license-Private-red.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-22%2B-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED.svg)](https://docker.com)

## 🎯 What is Argus?

Argus is a smart assistant that:
- 📱 **Monitors your WhatsApp** messages via Evolution API
- 🧠 **Extracts events** using Gemini AI (meetings, deadlines, reminders, shopping, subscriptions)
- 🔔 **Pushes notifications** to your browser in real-time via WebSocket
- 🎨 **Shows modal overlays** on any browser tab when events are detected
- 🔍 **Matches context** by analyzing URLs you visit + DOM form fields
- ⏰ **Triggers reminders** at the right time and place
- 🛒 **Gift Intent** — "buy lipstick for sis" → popup on Nykaa with sale info
- 🏥 **Insurance Accuracy** — detects car model mismatch on insurance forms via DOM watching

**Example:** Your friend texts "Let's meet at 3pm tomorrow at Starbucks". Argus:
1. Detects the event using Gemini
2. Pushes it to your browser via WebSocket
3. Shows a beautiful modal overlay with Accept/Dismiss actions
4. Later, when you visit Google Maps or Starbucks website, reminds you again

**Example:** You type "Honda Civic 2022" on an insurance site, but your WhatsApp chats say you own a 2018 model. Argus:
1. Detects the form input via DOM watcher
2. Cross-references with your WhatsApp memory
3. Shows a popup: "Hold on — you own a Honda Civic 2018! You might be overpaying!"
4. "✏️ Fix It" button auto-fills the correct value

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose (required)
- Chrome browser
- Gemini API key ([get one here](https://aistudio.google.com/apikey))

### Docker Deployment (Recommended)

```bash
# Clone the repository
git clone https://github.com/nityam2007/argus-whatsapp-assistant.git
cd argus-whatsapp-assistant/argus

# Configure environment
cp .env.example .env
# Edit .env → add your GEMINI_API_KEY (required)

# Build & start all 4 containers
docker compose up -d --build

# Check status
docker compose ps

# View logs
docker compose logs -f argus
docker compose logs -f evolution-api
```

### What gets started (4 containers)

| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| `argus-server` | argus (built from source) | 3000 | Main app — Express + WebSocket + Gemini AI |
| `argus-evolution` | evolution-api (built from source) | 8080 | WhatsApp bridge — QR login, message relay |
| `argus-postgres` | postgres:16-alpine | 5432 | Evolution API database |
| `argus-redis` | redis:7-alpine | 6379 | Evolution API cache |

### Load Chrome Extension

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `argus/extension/` folder
5. Pin the Argus extension to your toolbar

### Connect WhatsApp

1. Open `http://localhost:8080` (Evolution API)
2. Create instance named `arguas` with API key `rmd_evolution_api_key_12345`
3. Scan QR code with your WhatsApp
4. Set webhook URL: `http://argus:3000/api/webhook/whatsapp` (Docker) or `http://localhost:3000/api/webhook/whatsapp` (dev)

### Local Development (without Docker)

```bash
cd argus
npm install
cp .env.example .env    # Fill in GEMINI_API_KEY
npm run dev             # Start with hot reload
```

## 📁 Project Structure

```
whatsapp-chat-rmd-argus/
├── argus/                      # Main application
│   ├── src/
│   │   ├── server.ts           # Express + WebSocket server
│   │   ├── db.ts               # SQLite + FTS5 database
│   │   ├── evolution-db.ts     # PostgreSQL Evolution DB integration
│   │   ├── gemini.ts           # Gemini AI — extraction, popup blueprints, chat
│   │   ├── quicksave.ts        # QuickSave context compression (S2A + density)
│   │   ├── ingestion.ts        # Message processing + action detection pipeline
│   │   ├── matcher.ts          # URL pattern matching for context triggers
│   │   ├── scheduler.ts        # Time-based + snooze reminders
│   │   └── types.ts            # TypeScript types + config
│   ├── extension/              # Chrome Extension (Manifest V3)
│   │   ├── background.js       # WebSocket client, URL detection, context check
│   │   ├── content.js          # Modal overlays, toasts, DOM form watcher
│   │   ├── sidepanel.html/js   # AI Chat sidebar with markdown rendering
│   │   ├── popup.html/js       # Extension popup with event cards + stats
│   │   └── manifest.json       # Extension config — <all_urls> matching
│   ├── tests/                  # Vitest test suite
│   ├── Dockerfile              # Multi-stage Node 22 Alpine build
│   ├── docker-compose.yml      # Full stack — 4 containers
│   └── .env.example            # Environment template
├── evolution-api/              # WhatsApp API (forked, built from source)
│   ├── Dockerfile              # Multi-stage Node 24 Alpine build
│   └── ...                     # Evolution API source
├── Insurance website/          # Demo ACKO clone for insurance scenario
├── quicksave/                  # QuickSave CEP v9.1 reference (read-only)
│   ├── SKILL.md                # Full protocol specification
│   └── references/             # PDL, S2A, NCL, KANJI docs
├── RULES.md                    # Development rules & constraints
└── README.md                   # This file
```

## ✨ Features

### 8 Popup Types

| Type | Icon | When |
|------|------|------|
| `event_discovery` | 📅 💡 💳 | New event detected in WhatsApp |
| `event_reminder` | ⏰ | Scheduled time arrives |
| `context_reminder` | 🎯 💡 💳 | User visits relevant URL |
| `conflict_warning` | 🗓️ | Overlapping events detected |
| `insight_card` | 💡 | AI suggestion from conversations |
| `snooze_reminder` | ⏰ | Snoozed event fires again |
| `update_confirm` | 📝 | Message suggests event changes |
| `form_mismatch` | ⚠️ | DOM form field contradicts WhatsApp memory |

### Real-Time Event Broadcasting
- WebSocket pushes events instantly — zero polling
- Automatic reconnection with exponential backoff
- Gemini-generated popup blueprints (server sends complete UI spec)

### Context-Aware Triggers
- **Subscriptions:** "cancel netflix" → triggers on netflix.com
- **Travel:** "cashews in goa" → triggers on goa-related URLs
- **Shopping/Gifts:** "buy lipstick for sis" → triggers on nykaa.com with "sale going on" text
- **Insurance:** "Honda Civic 2022" typed on ACKO → mismatch popup with "Fix It" button
- **Conflicts:** overlapping events → shows warning with "View My Day" schedule

### DOM Form Watcher (Insurance Accuracy)
- Detects insurance-like pages (ACKO, PolicyBazaar, Digit, etc.)
- Monitors text inputs with 1.5s debounce
- Parses car make/model/year via regex
- Cross-references with WhatsApp chat memory
- "✏️ Fix It" button auto-fills correct value + green highlight

### QuickSave Context Compression (CEP v9.1)
All Gemini AI calls use QuickSave-inspired compression for optimal context density:
- **S2A Filter** — ranks events by signal (time proximity, status, recency, context_url) → top 60 sent to Gemini
- **Dense Format** — `#ID|TYPE|STATUS|"Title"|time|loc|sender|keywords` (~40-55% fewer tokens vs verbose)
- **L2 Edge Detection** — cross-event relationships appended (cancel↔subscription, time conflicts, topic overlap)
- **Chat Memory** — older AI sidebar turns compressed into key facts/questions, recent 6 turns stay raw
- Same Gemini token budget carries ~2x more event information
- Based on [QuickSave CEP v9.1](https://github.com/ktg-one/quicksave) by Kevin Tan (ktg.one)

### Gift Intent (Shopping Triggers)
- Detects shopping intent in WhatsApp ("buy makeup for sis birthday")
- Auto-maps to shopping URLs (beauty→Nykaa, fashion→Myntra, gifts→Amazon)
- Sale-aware popup text for recommendations

### Smart Event Processing
- Gemini-powered extraction with multi-interval alerts
- Spam filter (forwards, status updates, media-only)
- Duplicate detection (48h window)
- Action detection: cancel, complete, modify, postpone, ignore
- Smart date resolution (relative → absolute timestamps)
- Event CRUD with confirmation popups

### Direct Evolution DB Integration
- Query WhatsApp messages directly from PostgreSQL
- JSONB extraction for message content
- Instance name → UUID auto-resolution
- 43,000+ message search in <10ms

## 📡 API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Health check with DB status |
| `/api/stats` | GET | Message/event statistics |
| `/api/events` | GET | List events (filter by status) |
| `/api/events/:id` | PATCH | Update event fields (CRUD) |
| `/api/events/:id` | DELETE | Delete event permanently |
| `/api/events/:id/set-reminder` | POST | Schedule event |
| `/api/events/:id/snooze` | POST | Snooze for X minutes |
| `/api/events/:id/ignore` | POST | Ignore event |
| `/api/events/:id/complete` | POST | Mark done |
| `/api/events/:id/dismiss` | POST | Dismiss notification |
| `/api/events/:id/acknowledge` | POST | Acknowledge reminder |
| `/api/events/:id/confirm-update` | POST | Confirm pending modify |
| `/api/events/day/:timestamp` | GET | Get all events for a day |
| `/api/webhook/whatsapp` | POST | Evolution API webhook |
| `/api/context-check` | POST | Check URL for relevant events |
| `/api/extract-context` | POST | Extract context from URL |
| `/api/form-check` | POST | Check form field mismatch (insurance) |
| `/api/chat` | POST | AI Chat — context-aware conversation |
| `/ws` | WS | Real-time notifications |

## 🐳 Docker

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Compose Network                     │
│                                                               │
│  ┌──────────────┐    ┌──────────────────┐                    │
│  │   postgres    │    │      redis       │                    │
│  │  :5432        │    │     :6379        │                    │
│  └──────┬───────┘    └────────┬─────────┘                    │
│         │                     │                               │
│         ▼                     ▼                               │
│  ┌──────────────────────────────────────┐                    │
│  │         evolution-api :8080          │ ◄── WhatsApp QR    │
│  │    WhatsApp Bridge (Node 24)        │                     │
│  └──────────────┬───────────────────────┘                    │
│                 │ webhook + direct PG read                    │
│                 ▼                                             │
│  ┌──────────────────────────────────────┐                    │
│  │           argus :3000                │ ◄── Chrome Ext     │
│  │   Express + WebSocket + Gemini AI   │                     │
│  │   SQLite + FTS5 (internal)          │                     │
│  └──────────────────────────────────────┘                    │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Commands

```bash
cd argus

# Build & start everything
docker compose up -d --build

# View logs (all or specific)
docker compose logs -f
docker compose logs -f argus

# Stop
docker compose down

# Stop + delete volumes (reset data)
docker compose down -v

# Rebuild after code changes
docker compose build argus
docker compose up -d argus
```

### Cross-Platform Notes
- **Linux:** Works out of the box
- **Windows:** Requires Docker Desktop with WSL2 backend
- **macOS:** Requires Docker Desktop; `host.docker.internal` used for host access

## 🔧 Development

```bash
cd argus

npm run dev          # Start with hot reload
npm test             # Fast tests (~2s)
npm run build        # Build TypeScript
npm run typecheck    # Type check only
npm run lint         # Lint code
npm run format       # Format code
```

## 📊 Performance

| Metric | Value |
|--------|-------|
| Message ingestion | <500ms (Gemini extraction included) |
| Context check | <800ms (FTS5 search + matching) |
| Database query | <10ms (50k messages indexed) |
| Memory usage | <200MB (SQLite + Node runtime) |
| WebSocket latency | <50ms (event → browser overlay) |
| Form mismatch check | <100ms (regex parse + DB search) |
| QuickSave compression | ~2x density (40-55% fewer tokens per prompt) |
| Docker image size | ~180MB (Argus), ~600MB (Evolution) |

## 🏗️ Tech Stack

- **Runtime:** Node.js 22 (ESM)
- **Language:** TypeScript 5.7
- **Database:** SQLite 3 + FTS5 full-text search
- **AI:** Google Gemini 3 Flash Preview
- **WhatsApp:** Evolution API (built from source)
- **Evolution DB:** PostgreSQL 16
- **Cache:** Redis 7
- **Browser:** Chrome Extension (Manifest V3)
- **Real-time:** WebSocket (ws library)
- **Containers:** Docker Compose (4 services)
- **Context Compression:** QuickSave CEP v9.1 (S2A + density optimization)
- **Testing:** Vitest

## 📝 Changelog

See [CHANGELOG.md](argus/CHANGELOG.md) for full version history.

### Latest: v2.7.0 (2026-02-08)

**QuickSave Context Compression:**
- S2A filter + dense format for all Gemini prompts (~40-55% fewer tokens)
- L2 edge detection (cross-event relationships)
- Chat memory packets for session continuity

**All Demo Scenarios Working:**
- ✅ Goa Cashew — travel recommendation → URL context trigger
- ✅ Gift Intent — "buy lipstick for sis" → Nykaa popup with sale text
- ✅ Insurance Accuracy — DOM form mismatch detection + Fix It button
- ✅ Netflix Subscription — cancel reminder on netflix.com
- ✅ Calendar Conflict — overlapping event warnings + View My Day

## 📄 License

Private — All rights reserved

## 🙏 Acknowledgments

- [Evolution API](https://github.com/EvolutionAPI/evolution-api) — WhatsApp integration
- [Google Gemini](https://ai.google.dev/) — AI event extraction
- [SQLite FTS5](https://www.sqlite.org/fts5.html) — Full-text search
- [QuickSave CEP](https://github.com/ktg-one/quicksave) — Context compression protocol (Kevin Tan)
- Chrome Extension Manifest V3 — Browser integration

---

Built with ❤️ for seamless WhatsApp-browser integration
