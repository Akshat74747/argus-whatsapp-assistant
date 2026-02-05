import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { Message, Event, Trigger, Contact } from './types.js';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function initDb(dbPath: string): Database.Database {
  // Ensure directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = 10000');
  db.pragma('temp_store = MEMORY');

  // Migration: Add missing columns to existing tables
  try {
    // Check if reminder_time column exists in events table
    const tableInfo = db.prepare("PRAGMA table_info(events)").all() as Array<{ name: string }>;
    const hasReminderTime = tableInfo.some(col => col.name === 'reminder_time');
    const hasContextUrl = tableInfo.some(col => col.name === 'context_url');
    const hasDismissCount = tableInfo.some(col => col.name === 'dismiss_count');
    
    if (tableInfo.length > 0) { // Table exists
      if (!hasReminderTime) {
        console.log('⚙️  Adding reminder_time column to events table...');
        db.exec('ALTER TABLE events ADD COLUMN reminder_time INTEGER');
      }
      if (!hasContextUrl) {
        console.log('⚙️  Adding context_url column to events table...');
        db.exec('ALTER TABLE events ADD COLUMN context_url TEXT');
      }
      if (!hasDismissCount) {
        console.log('⚙️  Adding dismiss_count column to events table...');
        db.exec('ALTER TABLE events ADD COLUMN dismiss_count INTEGER DEFAULT 0');
      }
    }
  } catch (err) {
    // Table doesn't exist yet, will be created below
  }

  // Create tables
  db.exec(`
    -- Messages table
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_messages_chat_time ON messages(chat_id, timestamp DESC);

    -- Events table (with new columns for reminder flow)
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      event_time INTEGER,
      location TEXT,
      participants TEXT,
      keywords TEXT NOT NULL,
      confidence REAL,
      status TEXT DEFAULT 'discovered',
      reminder_time INTEGER,
      context_url TEXT,
      dismiss_count INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (message_id) REFERENCES messages(id)
    );
    CREATE INDEX IF NOT EXISTS idx_events_time ON events(event_time);
    CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
    CREATE INDEX IF NOT EXISTS idx_events_location ON events(location);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
    CREATE INDEX IF NOT EXISTS idx_events_reminder ON events(reminder_time);
    CREATE INDEX IF NOT EXISTS idx_events_context_url ON events(context_url);

    -- Contacts table
    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      name TEXT,
      first_seen INTEGER,
      last_seen INTEGER,
      message_count INTEGER DEFAULT 0
    );

    -- Triggers table
    CREATE TABLE IF NOT EXISTS triggers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      trigger_type TEXT NOT NULL,
      trigger_value TEXT,
      is_fired INTEGER DEFAULT 0,
      fire_count INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (event_id) REFERENCES events(id)
    );
    CREATE INDEX IF NOT EXISTS idx_triggers_unfired ON triggers(is_fired, trigger_type);
    CREATE INDEX IF NOT EXISTS idx_triggers_value ON triggers(trigger_value);

    -- Push subscriptions table
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT UNIQUE NOT NULL,
      keys TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- Context dismissals table (tracks dismissed context reminders per URL pattern)
    CREATE TABLE IF NOT EXISTS context_dismissals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      url_pattern TEXT NOT NULL,
      dismissed_until INTEGER,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (event_id) REFERENCES events(id)
    );
    CREATE INDEX IF NOT EXISTS idx_context_dismissals_url ON context_dismissals(url_pattern);
  `);

  // Create FTS5 virtual table for full-text search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
      title,
      description,
      keywords,
      location,
      content=events,
      content_rowid=id,
      tokenize='porter unicode61'
    );

    -- Triggers to keep FTS in sync
    CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
      INSERT INTO events_fts(rowid, title, description, keywords, location)
      VALUES (new.id, new.title, new.description, new.keywords, new.location);
    END;

    CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
      INSERT INTO events_fts(events_fts, rowid, title, description, keywords, location)
      VALUES ('delete', old.id, old.title, old.description, old.keywords, old.location);
    END;

    CREATE TRIGGER IF NOT EXISTS events_au AFTER UPDATE ON events BEGIN
      INSERT INTO events_fts(events_fts, rowid, title, description, keywords, location)
      VALUES ('delete', old.id, old.title, old.description, old.keywords, old.location);
      INSERT INTO events_fts(rowid, title, description, keywords, location)
      VALUES (new.id, new.title, new.description, new.keywords, new.location);
    END;
  `);

  console.log('✅ Database initialized:', dbPath);
  return db;
}

// ============ Message Operations ============
export function insertMessage(msg: Message): void {
  const stmt = getDb().prepare(`
    INSERT OR REPLACE INTO messages (id, chat_id, sender, content, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(msg.id, msg.chat_id, msg.sender, msg.content, msg.timestamp);
}

export function getRecentMessages(chatId: string, limit = 5): Message[] {
  const stmt = getDb().prepare(`
    SELECT * FROM messages
    WHERE chat_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `);
  return stmt.all(chatId, limit) as Message[];
}

export function getMessageById(id: string): Message | undefined {
  const stmt = getDb().prepare('SELECT * FROM messages WHERE id = ?');
  return stmt.get(id) as Message | undefined;
}

// ============ Event Operations ============
export function insertEvent(event: Omit<Event, 'id' | 'created_at'>): number {
  const stmt = getDb().prepare(`
    INSERT INTO events (message_id, event_type, title, description, event_time, location, participants, keywords, confidence, status, context_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    event.message_id,
    event.event_type,
    event.title,
    event.description,
    event.event_time,
    event.location,
    event.participants,
    event.keywords,
    event.confidence,
    event.status || 'pending',
    event.context_url || null
  );
  return result.lastInsertRowid as number;
}

export function getEventById(id: number): Event | undefined {
  const stmt = getDb().prepare('SELECT * FROM events WHERE id = ?');
  return stmt.get(id) as Event | undefined;
}

export function getPendingEvents(limit = 50): Event[] {
  const stmt = getDb().prepare(`
    SELECT * FROM events
    WHERE status = 'pending'
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(limit) as Event[];
}

export function getRecentEvents(days = 90, limit = 100): Event[] {
  const cutoff = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
  const stmt = getDb().prepare(`
    SELECT * FROM events
    WHERE created_at > ? AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(cutoff, limit) as Event[];
}

export function updateEventStatus(id: number, status: 'pending' | 'completed' | 'expired'): void {
  const stmt = getDb().prepare('UPDATE events SET status = ? WHERE id = ?');
  stmt.run(status, id);
}

// ============ Search Operations ============
export function searchEventsByLocation(location: string, days = 90, limit = 10): Event[] {
  const cutoff = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
  const stmt = getDb().prepare(`
    SELECT * FROM events
    WHERE location LIKE ? AND status = 'pending' AND created_at > ?
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(`%${location}%`, cutoff, limit) as Event[];
}

export function searchEventsByKeywords(keywords: string[], days = 90, limit = 10): Event[] {
  const cutoff = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
  
  // Try exact location match first
  for (const kw of keywords) {
    const exact = searchEventsByLocation(kw, days, limit);
    if (exact.length > 0) return exact;
  }
  
  // FTS5 search
  const query = keywords.join(' OR ');
  try {
    const stmt = getDb().prepare(`
      SELECT e.* FROM events e
      JOIN events_fts f ON e.id = f.rowid
      WHERE events_fts MATCH ? AND e.status = 'pending' AND e.created_at > ?
      ORDER BY rank
      LIMIT ?
    `);
    return stmt.all(query, cutoff, limit) as Event[];
  } catch {
    // Fallback to LIKE search
    const likeConditions = keywords.map(() => '(keywords LIKE ? OR title LIKE ? OR description LIKE ?)').join(' OR ');
    const likeParams = keywords.flatMap(kw => [`%${kw}%`, `%${kw}%`, `%${kw}%`]);
    const stmt = getDb().prepare(`
      SELECT * FROM events
      WHERE (${likeConditions}) AND status = 'pending' AND created_at > ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(...likeParams, cutoff, limit) as Event[];
  }
}

// ============ Trigger Operations ============
export function insertTrigger(trigger: Omit<Trigger, 'id' | 'created_at'>): number {
  const stmt = getDb().prepare(`
    INSERT INTO triggers (event_id, trigger_type, trigger_value, is_fired)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(trigger.event_id, trigger.trigger_type, trigger.trigger_value, trigger.is_fired ? 1 : 0);
  return result.lastInsertRowid as number;
}

export function getUnfiredTriggersByType(type: 'time' | 'url' | 'keyword'): Trigger[] {
  const stmt = getDb().prepare(`
    SELECT * FROM triggers WHERE trigger_type = ? AND is_fired = 0
  `);
  return stmt.all(type) as Trigger[];
}

export function getUnfiredUrlTriggers(): Trigger[] {
  const stmt = getDb().prepare(`
    SELECT t.*, e.title, e.description FROM triggers t
    JOIN events e ON t.event_id = e.id
    WHERE t.trigger_type = 'url' AND t.is_fired = 0 AND e.status = 'pending'
  `);
  return stmt.all() as Trigger[];
}

export function markTriggerFired(id: number): void {
  const stmt = getDb().prepare('UPDATE triggers SET is_fired = 1 WHERE id = ?');
  stmt.run(id);
}

// ============ Contact Operations ============
export function upsertContact(contact: Contact): void {
  const stmt = getDb().prepare(`
    INSERT INTO contacts (id, name, first_seen, last_seen, message_count)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = COALESCE(excluded.name, contacts.name),
      last_seen = excluded.last_seen,
      message_count = contacts.message_count + 1
  `);
  stmt.run(contact.id, contact.name, contact.first_seen, contact.last_seen, contact.message_count);
}

// ============ Stats ============
export function getStats(): { 
  messages: number; 
  events: number; 
  triggers: number;
  pendingEvents: number;
  completedEvents: number;
  expiredEvents: number;
} {
  const db = getDb();
  const messages = (db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number }).count;
  const events = (db.prepare('SELECT COUNT(*) as count FROM events').get() as { count: number }).count;
  const triggers = (db.prepare('SELECT COUNT(*) as count FROM triggers').get() as { count: number }).count;
  const pendingEvents = (db.prepare("SELECT COUNT(*) as count FROM events WHERE status = 'pending'").get() as { count: number }).count;
  const completedEvents = (db.prepare("SELECT COUNT(*) as count FROM events WHERE status = 'completed'").get() as { count: number }).count;
  const expiredEvents = (db.prepare("SELECT COUNT(*) as count FROM events WHERE status = 'expired'").get() as { count: number }).count;
  return { messages, events, triggers, pendingEvents, completedEvents, expiredEvents };
}

// ============ Message Queries ============
export function getAllMessages(options: {
  limit?: number;
  offset?: number;
  sender?: string;
}): Message[] {
  const { limit = 50, offset = 0, sender } = options;
  
  if (sender) {
    const stmt = getDb().prepare(`
      SELECT * FROM messages
      WHERE sender = ?
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `);
    return stmt.all(sender, limit, offset) as Message[];
  }
  
  const stmt = getDb().prepare(`
    SELECT * FROM messages
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `);
  return stmt.all(limit, offset) as Message[];
}

// ============ Event Queries ============
export function getAllEvents(options: {
  limit?: number;
  offset?: number;
  status?: 'pending' | 'completed' | 'expired' | 'all';
}): (Event & { source_message?: string; source_sender?: string })[] {
  const { limit = 50, offset = 0, status = 'all' } = options;
  
  if (status !== 'all') {
    const stmt = getDb().prepare(`
      SELECT e.*, m.content as source_message, m.sender as source_sender
      FROM events e
      LEFT JOIN messages m ON e.message_id = m.id
      WHERE e.status = ?
      ORDER BY e.created_at DESC
      LIMIT ? OFFSET ?
    `);
    return stmt.all(status, limit, offset) as (Event & { source_message?: string; source_sender?: string })[];
  }
  
  const stmt = getDb().prepare(`
    SELECT e.*, m.content as source_message, m.sender as source_sender
    FROM events e
    LEFT JOIN messages m ON e.message_id = m.id
    ORDER BY e.created_at DESC
    LIMIT ? OFFSET ?
  `);
  return stmt.all(limit, offset) as (Event & { source_message?: string; source_sender?: string })[];
}

// Find pending events matching keywords (for updates/cancellations)
export function findPendingEventsByKeywords(keywords: string[]): Event[] {
  if (keywords.length === 0) return [];
  
  const conditions = keywords.map(() => `keywords LIKE ?`).join(' OR ');
  const params = keywords.map(kw => `%${kw.toLowerCase()}%`);
  
  const stmt = getDb().prepare(`
    SELECT * FROM events
    WHERE status = 'pending' AND (${conditions})
    ORDER BY created_at DESC
    LIMIT 10
  `);
  
  return stmt.all(...params) as Event[];
}

export function deleteEvent(id: number): void {
  // Delete associated triggers FIRST (foreign key constraint)
  const triggerStmt = getDb().prepare('DELETE FROM triggers WHERE event_id = ?');
  triggerStmt.run(id);
  // Delete context dismissals
  const dismissStmt = getDb().prepare('DELETE FROM context_dismissals WHERE event_id = ?');
  dismissStmt.run(id);
  // Then delete the event
  const stmt = getDb().prepare('DELETE FROM events WHERE id = ?');
  stmt.run(id);
}

// ============ Enhanced Event Operations ============

// Schedule a reminder for an event (1 hour before event_time)
export function scheduleEventReminder(eventId: number): void {
  const event = getEventById(eventId);
  if (!event || !event.event_time) return;
  
  // Set reminder 1 hour before event
  const reminderTime = event.event_time - 3600; // 1 hour = 3600 seconds
  const now = Math.floor(Date.now() / 1000);
  
  // Only set if reminder time is in the future
  if (reminderTime > now) {
    const stmt = getDb().prepare(`
      UPDATE events SET status = 'scheduled', reminder_time = ? WHERE id = ?
    `);
    stmt.run(reminderTime, eventId);
    
    // Also create a time trigger
    insertTrigger({
      event_id: eventId,
      trigger_type: 'reminder_1hr',
      trigger_value: reminderTime.toString(),
      is_fired: false,
    });
  } else {
    // Event is within 1 hour or past, mark as scheduled without reminder
    const stmt = getDb().prepare(`
      UPDATE events SET status = 'scheduled' WHERE id = ?
    `);
    stmt.run(eventId);
  }
}

// Get events due for reminder (reminder_time has passed)
export function getDueReminders(): Event[] {
  const now = Math.floor(Date.now() / 1000);
  const stmt = getDb().prepare(`
    SELECT * FROM events
    WHERE status = 'scheduled' AND reminder_time IS NOT NULL AND reminder_time <= ?
    ORDER BY reminder_time ASC
  `);
  return stmt.all(now) as Event[];
}

// Mark event as reminded
export function markEventReminded(eventId: number): void {
  const stmt = getDb().prepare(`
    UPDATE events SET status = 'reminded' WHERE id = ?
  `);
  stmt.run(eventId);
}

// Get events with context URL that match a given URL
export function getContextEventsForUrl(url: string): Event[] {
  const stmt = getDb().prepare(`
    SELECT * FROM events
    WHERE context_url IS NOT NULL 
    AND status NOT IN ('completed', 'expired')
    AND ? LIKE '%' || context_url || '%'
  `);
  return stmt.all(url) as Event[];
}

// Dismiss a context event for a URL (can be temporary or permanent)
export function dismissContextEvent(eventId: number, urlPattern: string, permanent = false): void {
  if (permanent) {
    // Mark as completed (won't show again)
    updateEventStatus(eventId, 'completed');
  } else {
    // Increment dismiss count and store URL pattern for future reference
    const stmt = getDb().prepare(`
      UPDATE events SET dismiss_count = dismiss_count + 1 WHERE id = ?
    `);
    stmt.run(eventId);
    
    // Store dismissal with URL pattern (if provided) for potential re-trigger logic
    if (urlPattern) {
      try {
        const dismissStmt = getDb().prepare(`
          INSERT INTO context_dismissals (event_id, url_pattern, dismissed_until)
          VALUES (?, ?, ?)
        `);
        // Dismiss for 30 minutes
        const dismissUntil = Math.floor(Date.now() / 1000) + 1800;
        dismissStmt.run(eventId, urlPattern, dismissUntil);
      } catch (e) {
        // Table might not exist in older DBs, ignore
      }
    }
  }
}

// Set context URL for an event (for URL-based triggers like Netflix)
export function setEventContextUrl(eventId: number, contextUrl: string): void {
  const stmt = getDb().prepare(`
    UPDATE events SET context_url = ? WHERE id = ?
  `);
  stmt.run(contextUrl, eventId);
  
  // Also create a URL trigger
  insertTrigger({
    event_id: eventId,
    trigger_type: 'url',
    trigger_value: contextUrl,
    is_fired: false,
  });
}

// Get events by status
export function getEventsByStatus(status: string, limit = 50): Event[] {
  const stmt = getDb().prepare(`
    SELECT * FROM events WHERE status = ? ORDER BY created_at DESC LIMIT ?
  `);
  return stmt.all(status, limit) as Event[];
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
