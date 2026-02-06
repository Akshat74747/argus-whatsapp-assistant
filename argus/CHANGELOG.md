# Changelog

All notable changes to Argus will be documented in this file.

## [2.6.2] - 2026-02-06

### Fixed — "Smart Date Resolution"

Gemini was resolving relative day names ("Thursday") to different weeks depending on when each message was processed, causing conflict detection to fail when two messages in the same conversation both said "Thursday". Root cause: Gemini only received a bare ISO date string with no day-of-week info, no message timestamp, and no rules about future-date resolution.

### Added
- **`formatDateContext()` — Rich Date Context Helper** (`gemini.ts`)
  - Pre-resolves ALL 7 upcoming day names to specific calendar dates (e.g., `"Thursday" → Thursday, February 12, 2026`)
  - Includes day-of-week for "today", "tomorrow"/"kal", "day after"/"parso"
  - Shows both current server time AND message send time
  - Pre-resolves "this week", "this month", "next week" to unambiguous dates
  - Gemini no longer has to guess — every relative day maps to a single date

- **Absolute Date Resolution Rules** in `analyzeMessage()` prompt
  - "Use the pre-resolved dates from the DATE/TIME CONTEXT — do NOT calculate yourself"
  - "If two messages say 'Thursday 8pm' and 'Thursday 8:30pm' → SAME Thursday"
  - "event_time MUST be in the FUTURE unless explicitly past-tense"
  - Hinglish time-of-day defaults: "subah"=9AM, "dopahar"=1PM, "shaam ko"=6PM, "raat ko"=9PM
  - Day names without specific time default to 10:00 AM

- **Past-date safety guard** (`ingestion.ts`)
  - All three event_time parse sites (new events, CRUD updates, modify actions) now check for past dates
  - If Gemini returns a date >1 hour in the past, automatically pushes forward by 7-day increments
  - Logs `⏩ [Date Fix]` when correcting, so issues are visible in server output
  - NaN guard added to prevent corrupt timestamps from reaching the database

### Changed
- **`analyzeMessage()`** — new `messageTimestamp` parameter; replaced bare `Current date: <ISO>` with full `formatDateContext()` block
- **`detectAction()`** — new `messageTimestamp` parameter + date context injected into prompt (was completely missing before — "change to Friday" had no idea which Friday)
- **`chatWithContext()`** — uses `formatDateContext()` instead of manual `todayStr`/`toLocaleTimeString`; events display now shows `[PAST]` tag for expired items; added instructions for future-only filtering and day-of-week display
- **`processWebhook()`** — passes `message.timestamp` to `detectAction()` 
- **`processMessage()`** — passes `message.timestamp` to `extractEvents()`

### Test Results
- "Dinner Thursday at 8pm" → Thu, Feb 12, 2026 8:00 PM ✅ (next Thursday)
- "I'll be there Thursday at 8:30pm" → modify action on same event → Thu, Feb 12, 8:30 PM ✅ (same Thursday)
- AI Chat: "What do I have this week?" → correctly shows "Thursday, February 12th at 8:30 PM" with day-of-week ✅

## [2.6.0] - 2026-02-06

### Architecture — "Let Gemini Do Everything"

Two major architectural changes that remove brittle human-coded logic and let Gemini AI handle classification, extraction, AND popup generation in a single intelligent pipeline.

### Removed
- **`classifyMessage()` heuristic eliminated** — The 70+ line regex-based keyword classifier (`eventKeywords`, `timePatterns`, `intentPatterns`, `highValueKeywords`, `actionPatterns`, `noisePatterns`) has been completely removed
  - Was the source of false positives AND false negatives — keywords like "complete", "will", "send" matched casual chat; meanwhile legitimate events without time references were silently dropped
  - Replaced by `shouldSkipMessage()` — a trivial 15-line pre-filter that only skips provably empty/noise messages (pure emoji, "ok", "lol", single-word acks, <3 chars)
  - Everything else goes straight to Gemini — no more brittle keyword gates
- **`generateNotificationMessage()` removed** — Was never actually called anywhere (dead code since v2.0). Superseded by `generatePopupBlueprint()`
- **Old two-step classify→extract pipeline removed** — `classifyMessage()` + `extractEvents()` as separate calls is gone

### Added
- **`analyzeMessage()` — Unified Gemini Analysis** (`gemini.ts`)
  - Single Gemini call replaces both `classifyMessage()` AND `extractEvents()`
  - Gemini decides if a message has events AND extracts them in one shot
  - Full SYSTEM_PROMPT, noise filter, spam filter, and extraction rules all inline
  - `extractEvents` kept as backward-compatible alias for batch import

- **`shouldSkipMessage()` — Trivial Pre-filter** (`gemini.ts`)
  - Synchronous, zero API cost — just prevents wasting Gemini calls on "ok", "👍", "lol"
  - NOT a classifier — it's a garbage filter. If in doubt, it lets the message through to Gemini

- **`generatePopupBlueprint()` — AI-Driven Popup Spec** (`gemini.ts`)
  - Gemini generates the COMPLETE popup specification: icon, headerClass, title, subtitle, body, question, and buttons (with text, action, style for each)
  - Server attaches popup blueprint to every WebSocket broadcast
  - Chrome extension renders whatever the API says — no hardcoded popup templates
  - `PopupBlueprint` and `PopupButton` interfaces exported for type safety
  - Fallback: `getDefaultPopupBlueprint()` generates sensible defaults if Gemini fails

- **API-Driven Popup Rendering** (`content.js`)
  - `showModal()` now checks `extraData.popup` first — if server sent a blueprint, use it directly
  - `getModalConfig()` kept as fallback for backward compatibility (old events without blueprints)
  - Extension is now a pure renderer — adding new popup types requires ZERO extension code changes

### Changed
- **`ingestion.ts`**: `classifyMessage` import removed → `shouldSkipMessage` imported instead. Two-step classify→extract replaced with trivial pre-filter → single `analyzeMessage()` call
- **`server.ts`**: Every `broadcast()` call now attaches a `popup` field with Gemini-generated blueprint. Webhook handler, scheduler callback, and context-check all call `generatePopupBlueprint()` before broadcasting
- **`background.js`**: `handleWebSocketMessage()` passes `data.popup` through to all content.js messages
- **`content.js`**: All message listeners pass `message.popup` to `showModal()` via extraData. Version bumped to v2.6
- **`scheduler.ts`**: `NotifyCallback` type updated to `void | Promise<void>` (scheduler callback is now async for popup generation)
- **Flowchart**: Rewritten to show unified `analyzeMessage()` + `generatePopupBlueprint()` flow. `classifyMessage` and `extractEvents` nodes replaced. Shows popup blueprint path through AI → WS → Extension

### Why This Matters
- **Extensibility**: Want a new popup type? Just describe it in the Gemini prompt. Zero code changes in the extension.
- **Accuracy**: Gemini understands "bro try cashews at Zantyes in Goa" as a recommendation — no keyword list ever will.
- **Fewer API calls**: One Gemini call per message instead of two (classify + extract were separate).
- **Dynamic buttons**: Server can return 2, 3, or 5 buttons with any labels/actions — extension just renders them.
- **Dead code cleanup**: `generateNotificationMessage()` was defined but never wired in since v2.0.

### Verified Scenarios
- **#1 Goa Cashew**: "Bro try cashews at Zantyes in Goa" → `shouldSkipMessage()` passes → `analyzeMessage()` extracts recommendation → `generatePopupBlueprint()` creates popup with 📍 Save Location button ✅
- **#4 Netflix Cancel**: "I need to cancel Netflix" → `shouldSkipMessage()` passes → `analyzeMessage()` extracts subscription task → context_url=netflix → context-check generates popup with ✅ Already Done button ✅
- **#5 Calendar Conflict**: "Dinner Thursday at 8" → `analyzeMessage()` extracts meeting → conflict detected → `generatePopupBlueprint()` creates popup with 📅 View My Day button ✅

## [2.5.1] - 2026-02-06

### Fixed
- **Massive False Event Reduction** — Complete overhaul of the event filtering pipeline to eliminate ~90% of garbage events
  - `gemini.ts classifyMessage()`: Removed overly broad keywords (`complete`, `will`, `send`, `get`, `buy`, `bring`, `try`, `plan`, `event`, `task`, `todo`, `recommend`, `shop`, `visit`, `drinks`) that matched casual chat
  - `gemini.ts classifyMessage()`: Added **noise filter** — rejects dev/coding chat (`create problem`, `debug`, `deploy`, `vibe coding`, `play with api`, `check after dev`, etc.)
  - `gemini.ts classifyMessage()`: Added **high-value keyword** tier — services (`netflix`, `canva`, `spotify`), travel (`cashew`, `zantyes`, `flight`), and social (`dinner`, `lunch`, `birthday`) always pass to Gemini even without time/intent
  - `gemini.ts classifyMessage()`: Single generic keyword without time or intent now rejected (was previously forwarded to Gemini)
  - `gemini.ts extractEvents()`: Added comprehensive **NOISE FILTER** rules — excludes dev chat, vague "I will" statements, status updates, past-tense reports, casual work conversation, generic social chat, short ambiguous fragments
  - `gemini.ts extractEvents()`: Added explicit ✅/❌ examples for Gemini to learn from
  - `gemini.ts SYSTEM_PROMPT`: Strengthened to emphasize "VERY conservative" and "CLEAR, SPECIFIC, ACTIONABLE intent"
  - `ingestion.ts`: Confidence threshold raised from `0.4` → `0.65`
  - `ingestion.ts`: Fixed auto-scheduling — events now default to `'discovered'` status (was incorrectly auto-scheduling timeless events to `'scheduled'`); only context/URL events go to `'scheduled'`

### Added
- **Event Deduplication** — New `findDuplicateEvent(title, hoursWindow)` in `db.ts`
  - Exact title match (case-insensitive, trimmed)
  - Fuzzy match: title containment check for slight variations (e.g., "Try cashews at Zantyes" vs "Try cashews at Zantye's")
  - Special character normalization (strips apostrophes, hyphens, backticks)
  - 48-hour dedup window — prevents the same event from being created multiple times
  - `ingestion.ts processMessage()`: Dedup check runs before `insertEvent()`, skips with log message

### Changed
- **Flowchart Rewrite** — Complete rewrite of `flowchart TB.mmd`
  - Fixed model name: "Gemini 2.5 Flash Preview" → "Gemini 3 Flash Preview"
  - Added filtering pipeline nodes: Confidence Gate (≥0.65), Dedup Check, Noise Filter
  - Added 3 Core Scenarios section: 🥜 Goa Cashew, 📺 Netflix Cancel, 📅 Calendar Conflict
  - Shows skip paths for rejected events (low confidence, duplicates, noise)
  - Added new API endpoint `/api/events/day/:timestamp`
  - Accurate scheduler intervals (24h·1h·15m triggers)

### Verified Scenarios
- **#1 Goa Cashew**: "Bro try cashews at Zantyes in Goa" → high-value keyword match → Gemini extracts recommendation → context_url=goa → URL trigger on travel sites ✅
- **#4 Netflix Cancel**: "I need to cancel Netflix" → high-value keyword match → Gemini extracts subscription task → context_url=netflix → URL trigger on netflix.com ✅
- **#5 Calendar Conflict**: "Dinner Thursday at 8" → high-value keyword + time match → Gemini extracts meeting → time triggers created → conflict detected on overlap ✅

### False Positives Now Rejected
- "Create problems 104 in PC" → noise filter ❌
- "Complete restosmem broo" → no keyword match ❌
- "I will start robotics man" → no signals ❌
- "Play with APIs" → noise filter ❌
- "Share design" → no signals ❌
- "Upgrade vibe coding game" → noise filter ❌
- "Send payment via UPI" → single generic keyword, no time/intent ❌

## [2.5.0] - 2026-02-06

### Added
- **Multi-Interval Alerts** - Events now create 3 time triggers (24h, 1h, 15min before) instead of just 1
  - `ingestion.ts`: Creates `time_24h`, `time_1h`, `time_15m` triggers per event
  - `db.ts`: `scheduleEventReminder()` creates `reminder_24h`, `reminder_1hr`, `reminder_15m` triggers
  - `scheduler.ts`: `checkTimeTriggers()` now checks all 7 time-based trigger types
  - `types.ts`: `TriggerTypeEnum` expanded with new trigger types
- **View My Day (Reschedule UX)** - Conflict popup now shows "📅 View My Day" button
  - `db.ts`: New `getEventsForDay(dayTimestamp)` function — returns all events for a calendar day
  - `server.ts`: New `GET /api/events/day/:timestamp` endpoint
  - `background.js`: New `GET_DAY_EVENTS` message handler
  - `content.js`: `showDayScheduleInline()` renders inline day timeline in conflict modal with color-coded dots (green=ok, red=overlap, blue=new)
- **Gemini System Prompt** - All Gemini calls now include a system message via `SYSTEM_PROMPT` constant
  - Defines Argus identity, Hinglish understanding, spam/promo detection rules
  - `callGemini()` now sends `[{role: 'system'}, {role: 'user'}]` instead of just user
- **Spam/Promotion Filter** - `extractEvents()` prompt now includes explicit spam detection rules
  - Price patterns ("at just ₹199", "50% off") flagged as promotional (confidence < 0.3)
  - Brand/business sender detection
  - Clear examples: genuine intent vs spam
- **Service Keywords Expanded** - Added canva, figma, notion, slack, zoom to `serviceKeywords` in ingestion.ts

### Changed
- **Dashboard: "Active Triggers" → "Scheduled"** - Hid internal trigger count from users; now shows `scheduledEvents` count instead
- **Conflict Popup Buttons** - Changed from "🔄 Suggest Another Time" to "📅 View My Day" (primary), "✅ Keep Both" (secondary)

### Technical
- `getUnfiredTriggersByType()` signature changed from union literal to `string` for flexibility
- `TriggerType` import added to `db.ts` and `ingestion.ts` for typed interval arrays

## [2.4.2] - 2026-02-06

### Fixed
- **Canva Events Not Triggering** - `getContextEventsForUrl()` now matches by `location` field when `context_url` is null (OR clause in SQL)
- **Scheduled Events Not Found** - `searchEventsByLocation()` and `searchEventsByKeywords()` now check `status IN ('pending', 'scheduled')` instead of just `'pending'`
- **Canva URL Not Detected** - Added `canva.com` pattern to `URL_PATTERNS` in matcher.ts

### Changed
- **Humanized Conflict Popup** - Changed from "Schedule Conflict!" to "Hmm, you might be double-booked" with conversational tone
- **Conflict Detail Section** - Changed from red to orange styling, added formatted date/time display

### Tested
- All 4 scenarios pass via `test-scenarios.sh`:
  - Goa Cashew: 4 context triggers
  - Netflix Cancel: 1 trigger
  - Canva Pro: 2 triggers ("Get Canva Pro" + "Canva Pro Edu")
  - Calendar Conflict: AI correctly identifies overlapping Team standup + Client call

## [2.4.1] - 2026-02-06

### Fixed
- **XSS Vulnerabilities** - Added `escapeHtml()` to index.html dashboard; all event titles, descriptions, locations, WhatsApp messages, and phone numbers are now sanitized
- **Duplicate `scheduleEvent()`** - Removed duplicate function definition in index.html (was defined twice)
- **Wrong Initial Filter** - Dashboard `currentFilter` changed from `'pending'` to `'discovered'` to match the active tab
- **Misleading `dismissEvent` Alias** - Removed `dismissEvent = snoozeEvent` alias (dismiss ≠ snooze)
- **Missing CSS Badge Classes** - Added `badge-dismissed` and `badge-pending` styles
- **Version Header Mismatch** - background.js header comment updated from v2.2 to v2.4

### Added
- **AI Chat Test Tool** - Dashboard Test Tools section now includes AI Chat tester (`/api/chat` endpoint)
- **ARCH.pdf** - PDF export of architecture diagram via `mmdc` CLI
- **Complete API Docs** - Settings section now lists all 14 endpoints including set-reminder, snooze, ignore, dismiss, acknowledge, chat

### Changed
- **Hardcoded Name Removed** - sidepanel.html quick action changed from "What did Rahul recommend?" to generic "Show all recommendations from friends"

## [2.4.0] - 2026-02-06

### Added
- **AI Chat Sidebar** - Side panel for conversational AI assistant with full event context
  - `sidepanel.html` / `sidepanel.js` - Dark-themed chat UI with markdown rendering
  - `/api/chat` endpoint - Context-aware Gemini conversations
  - `chatWithContext()` in gemini.ts - Fetches recent events for grounded answers
  - Quick action buttons (upcoming events, overdue check, summary)
- **SidePanel Chrome API** - `chrome.sidePanel.setPanelBehavior()` + `OPEN_SIDE_PANEL` message handler in background.js
- **Action Detection Pipeline** - `detectAction()` for NLP-based actions (mark done, cancel, reschedule) before event extraction

### Fixed
- **CRITICAL: Service Worker Crash** - Removed `"type": "module"` from manifest.json background config; background.js uses classic scripts, not ES modules (caused line 49 crash)
- **EventStatusEnum Mismatch** - Added `'snoozed'` and `'ignored'` to Zod schema in types.ts (were used by db.ts but missing from validation)
- **Shadowed Variable** - Renamed duplicate `searchText` to `travelSearchText` in ingestion.ts `processMessage()` to avoid variable shadowing
- **Snooze Missing Body** - sidepanel.js snooze action now sends proper JSON body (`{ minutes: 30 }`) with `Content-Type: application/json` header
- **SidePanel Not Opening** - Added `chrome.sidePanel.open()` handler and `setPanelBehavior` initialization in background.js

### Changed
- **background.js v2.4** - Version bump, sidePanel integration
- **CRITICAL DATE/TIME RULE** - Gemini prompt now explicitly forbids fabricated dates; must use only dates from message text or current timestamp

## [2.3.2] - 2026-02-05

### Fixed
- **Duplicate popups** - Server now sends ONLY ONE notification per event (not both notification + conflict_warning)
- **Scheduler popup types** - Now sends correct message type based on popupType (trigger for reminders, notification for snooze)

### Tested
- All 7 Gemini event types working:
  - `meeting` - "Team standup tomorrow at 10am"
  - `deadline` - "Project deadline Friday 5pm"
  - `reminder` - "Don't forget to call grandma"
  - `travel` - "Trip to Manali next month"
  - `task` - "Buy groceries, pick up laundry"
  - `subscription` - "Cancel Spotify subscription"
  - `recommendation` - "Try biryani at Meghana Foods"

## [2.3.1] - 2026-02-05

### Fixed
- **Chrome Popup buttons** - Changed from inline onclick to addEventListener with data-action attributes
- **Dismiss loop bug** - Added dismissedEventIds and handledEventIds Sets to prevent popup reopening
- **Content script actions** - Added schedule, snooze, ignore, complete actions to handleAction()
- **Background.js message handlers** - Added SNOOZE_EVENT and IGNORE_EVENT handlers
- **WebSocket auto-refresh** - Webapp now handles all event types: event_scheduled, event_snoozed, event_ignored, event_completed

### Changed
- **popup.js v2.2** - Buttons disable during API calls, auto-refresh every 5s
- **content.js v2.2** - Tracks handled events to prevent re-showing
- **background.js v2.3** - Better logging for all API calls

## [2.3.0] - 2026-02-05

### Added
- **Proper Event Status System** - Complete lifecycle management with meaningful statuses:
  - `discovered` → New event from WhatsApp (needs user action)
  - `scheduled` → User approved, will show context reminders & 1hr before notifications
  - `snoozed` → User said "later", will remind again in 30 minutes
  - `ignored` → User doesn't care (hidden but not deleted)
  - `reminded` → 1-hour before reminder was shown
  - `completed` → User marked as done
  - `expired` → Event time passed without action

- **New Event Actions**:
  - `📅 Schedule` - Approve event for reminders (discovered → scheduled)
  - `💤 Snooze` - Remind again in 30 minutes (any → snoozed)
  - `🚫 Ignore` - Hide event without deleting (discovered → ignored)
  - `✅ Done` - Mark as completed (scheduled → completed)
  - `↩️ Restore` - Bring back ignored event (ignored → scheduled)
  - `🗑️ Delete` - Permanent removal (only for ignored/completed)

- **API Endpoints**:
  - `POST /api/events/:id/set-reminder` - Schedule event
  - `POST /api/events/:id/snooze` - Snooze for X minutes
  - `POST /api/events/:id/ignore` - Ignore event
  - `POST /api/events/:id/complete` - Mark done
  - `DELETE /api/events/:id` - Delete permanently

- **Snooze Scheduler** - Background job checks every 30s for snoozed events that are due
- **Extension host_permissions** - Changed from localhost-only to `<all_urls>` for popup on any tab
- **Tab detection** - Popups now show on any active tab, not just localhost:3000

### Changed
- **Dashboard tabs** - New: 🆕 New | 📅 Active | 💤 Snoozed | ✅ Done | 🚫 Ignored | 📋 All
- **Chrome popup tabs** - New: 🆕 New | 📅 Active | ✅ Done
- **Stats** - pendingEvents now = discoveredEvents + snoozedEvents
- **Action buttons** - Contextual based on event status (no delete for discovered)

### Fixed
- **Popup not appearing on external sites** - manifest.json host_permissions now `<all_urls>`
- **Context reminders require approval** - Only shows for `scheduled` events
- **Event flow clarity** - Removed ambiguous "pending" status

### User Flow
1. WhatsApp message → Event discovered → Popup on current tab
2. User clicks "📅 Schedule" → Status = scheduled
3. User visits netflix.com → Context reminder popup (only if scheduled)
4. User clicks "✅ Done" → Status = completed

OR

1. User clicks "💤 Snooze" → Status = snoozed, reminder_time = now + 30min
2. After 30 min → Scheduler re-shows popup, status → discovered

## [2.2.0] - 2026-02-05

### Added
- **Calendar conflict detection** - Warns when new events conflict with existing events (±1 hour window)
- **Travel/Goa scenario** - Any message mentioning travel destinations sets context_url for URL matching
- **Service name extraction** - Subscriptions use just the service name (netflix, hotstar) not full domain
- **Enhanced Gemini prompt** - Better extraction of service names and travel destinations

### Fixed
- **URL matching** - Now case-insensitive, matches if URL contains the keyword anywhere
- **Subscription context** - "want to cancel netflix" now correctly sets context_url="netflix"
- **Travel context** - "Rahul recommended cashews in Goa" now sets context_url="goa"

### Scenarios Working
- ✅ **Netflix Subscription** - "cancel my netflix" + visit netflix.com → shows reminder
- ✅ **Goa Cashew** - "cashews in goa" + visit goatourism.com → shows reminder  
- ✅ **Calendar Conflict** - Create overlapping event → shows conflict warning

### Technical
- `checkEventConflicts()` function in db.ts for conflict detection
- `context_url` now stores just keywords (netflix, goa) not full domains
- URL matching: `LOWER(url) LIKE '%' || LOWER(context_url) || '%'`

## [2.1.0] - 2026-02-06

### Added
- **Root dev script** - `npm run dev` from project root runs both Evolution API and Argus concurrently
- **Subscription keyword detection** - Classifier now recognizes netflix, amazon, prime, subscription keywords
- **Typo tolerance** - Message classifier handles typos like "cancle" → "cancel"
- **Intent pattern recognition** - Detects "want to", "need to", "planning to" patterns

### Fixed
- **Chrome notification removed** - All popups now display as in-page overlays (no more native Chrome notifications)
- **Context check API response** - Returns full `contextTriggers` array instead of just count
- **Popup persistence** - Context reminder popups stay visible until user takes action
- **Tab change handling** - Popups no longer disappear when switching tabs

### Changed
- **Extension v2.1** - Complete rewrite of background.js and content.js for cleaner code
- **Consistent logging** - All extension logs use `[Argus]` prefix
- **Variable naming** - Standardized variable names across extension files

### Scenarios Supported
- ✅ Netflix Subscription (visit netflix.com → shows cancel reminder)
- ⏳ Goa Cashew (visit travel sites → shows recommendation)
- ⏳ Gift Intent (visit shopping sites → shows suggestion)
- ⏳ Insurance Accuracy (visit insurance sites → shows correction)
- ⏳ Calendar Conflict (scheduling conflicts → shows warning)

## [1.2.0] - 2026-02-05

### Added
- **Multi-type popup system** - 5 different modal types for different scenarios:
  - `event_discovery` - New event detected, ask user to set reminder
  - `event_reminder` - 1 hour before event notification (with countdown)
  - `context_reminder` - URL-based triggers (Netflix scenario) - persistent until done
  - `conflict_warning` - Calendar conflict alerts
  - `insight_card` - Recommendations and suggestions
- **Smart reminder flow**:
  - New events start as `discovered` (not auto-scheduled)
  - User can choose to "Set Reminder" or dismiss
  - Automatic 1-hour-before reminder for scheduled events
  - Context reminders reappear when visiting same URL
- **Event status system** - Events now have proper lifecycle:
  - `discovered` → `scheduled` → `reminded` → `completed`
  - `dismissed` status for temporary dismissals
- **Context URL triggers** - Set URL patterns to trigger events (like Netflix cancellation reminder)
- **New API endpoints**:
  - `POST /api/events/:id/set-reminder` - Schedule reminder for event
  - `POST /api/events/:id/dismiss` - Temporary or permanent dismissal
  - `POST /api/events/:id/acknowledge` - Acknowledge 1-hour reminder
  - `POST /api/events/:id/done` - Mark event as completed
  - `POST /api/events/:id/context-url` - Set URL trigger for event
  - `GET /api/events/status/:status` - Query events by status
- **Reminder scheduler** - Background job checks for due reminders every 30 seconds
- **Temporary dismissal tracking** - Context reminders wait 30 minutes before showing again

### Changed
- Extension popups now have 3 buttons for more control (Set Reminder / Not Now / Delete)
- Modal headers have different colors based on popup type
- Reminder popups have pulsing animation for urgency
- Events are created with `discovered` status by default

## [1.1.0] - 2026-02-05

### Added
- **WebSocket event broadcasting** - Events are now pushed to browser extension in real-time
- **Modal overlay notifications** - Centered modal popup for new events (similar to survey overlays)
- **Chrome notification integration** - Native notifications with Accept/Dismiss actions
- **Extension debug logging** - Added comprehensive logging for troubleshooting
- **Evolution DB direct integration** - Query PostgreSQL directly for WhatsApp messages
- **Instance ID resolution** - Auto-resolve instance name to UUID for queries
- **JSONB query support** - Proper extraction from Evolution's JSONB columns
- **Source message tracking** - Events now include reference to originating WhatsApp message
- **Event cancellation detection** - DB function to find events by keywords for updates

### Fixed
- **Content script syntax error** - Fixed escaped backticks in template strings
- **Foreign key constraint error** - Delete triggers before events to avoid FK violation
- **JSONB parsing** - Handle pg auto-parsed JSONB objects in message content
- **Instance name vs UUID** - Proper resolution from name to UUID for database queries

### Changed
- Ingestion now returns created events with full data for broadcasting
- WebSocket clients receive full event objects instead of just counts
- Extension shows centered modal for new events instead of toast notification
- Background service worker logs WebSocket messages for debugging

## [1.0.0] - 2026-02-04

### Added
- Initial project setup with ultra-simple architecture
- SQLite database with FTS5 full-text search
- Gemini 3 Flash integration for event extraction
- Chrome Extension (Manifest V3) for URL detection
- WebSocket support for real-time notifications
- Evolution API webhook integration
- Context matching with cascading SQL queries
- Time-based trigger scheduler
- Overlay notifications in browser
- Docker Compose deployment with pre-built images
- Fast test suite with Vitest (~2s execution)
- ESLint + Prettier for code quality

### Architecture Decisions
- No FAISS/Vector embeddings - using SQLite FTS5 instead
- No OpenAI - Gemini only (per hackathon requirements)
- Single container per user model
- 90-day hot window for context matching
- URL detection only (no DOM reading for MVP)

