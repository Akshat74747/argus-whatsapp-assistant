# Changelog

All notable changes to Argus will be documented in this file.

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

