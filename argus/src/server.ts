import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { initDb, getStats, getEventById, closeDb, getAllMessages, getAllEvents, deleteEvent, scheduleEventReminder, dismissContextEvent, setEventContextUrl, updateEventStatus, getEventsByStatus } from './db.js';
import { initGemini } from './gemini.js';
import { processWebhook } from './ingestion.js';
import { matchContext, extractContextFromUrl } from './matcher.js';
import { startScheduler, stopScheduler, completeEvent, checkContextTriggers } from './scheduler.js';
import { parseConfig, WhatsAppWebhookSchema, ContextCheckRequestSchema } from './types.js';
import { 
  initEvolutionDb, 
  testEvolutionConnection, 
  getEvolutionMessages, 
  getEvolutionStats, 
  getEvolutionInstances,
  getEvolutionContacts,
  getEvolutionChats,
  searchEvolutionMessages,
  closeEvolutionDb,
  getInstanceIdByName
} from './evolution-db.js';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolved instance ID (UUID)
let resolvedInstanceId: string | null = null;

// Load config
const config = parseConfig();

// Initialize services
initDb(config.dbPath);
initGemini({
  apiKey: config.geminiApiKey,
  model: config.geminiModel,
  apiUrl: config.geminiApiUrl,
});

// Initialize Evolution PostgreSQL if configured
let evolutionDbReady = false;
if (config.evolutionPg) {
  initEvolutionDb(config.evolutionPg);
  testEvolutionConnection().then(async (ok) => {
    evolutionDbReady = ok;
    if (ok) {
      console.log('✅ Evolution PostgreSQL connected');
      // Resolve instance name to ID
      if (config.evolutionInstanceName) {
        resolvedInstanceId = await getInstanceIdByName(config.evolutionInstanceName);
        if (resolvedInstanceId) {
          console.log(`✅ Instance "${config.evolutionInstanceName}" → ${resolvedInstanceId}`);
        } else {
          console.log(`⚠️ Instance "${config.evolutionInstanceName}" not found, will query all`);
        }
      } else {
        console.log('⚠️ No instance name configured, will query all');
      }
    } else {
      console.log('⚠️ Evolution PostgreSQL not available');
    }
  });
}

// Create Express app
const app = express();
app.use(cors());
app.use(express.json());

// Serve static files (dashboard)
app.use(express.static(join(__dirname, 'public')));

// Create HTTP server
const server = createServer(app);

// WebSocket server for real-time notifications (on root path for browser compatibility)
const wss = new WebSocketServer({ server });
const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('🔌 WebSocket client connected');
  
  ws.on('close', () => {
    clients.delete(ws);
    console.log('🔌 WebSocket client disconnected');
  });
});

function broadcast(data: object): void {
  const message = JSON.stringify(data);
  const type = 'type' in data ? (data as { type: string }).type : 'unknown';
  console.log(`📢 Broadcasting to ${clients.size} clients:`, type);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      console.log('   ✅ Sent to client');
    }
  }
}

// Start scheduler
startScheduler((event) => {
  broadcast({ type: 'notification', event });
});

// ============ API Routes ============

// Health check
app.get('/api/health', async (_req: Request, res: Response) => {
  const evolutionOk = evolutionDbReady ? await testEvolutionConnection() : false;
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    model: config.geminiModel,
    version: '1.0.0',
    evolutionDb: evolutionOk ? 'connected' : 'disconnected',
  });
});

// Stats (combined Argus + Evolution)
app.get('/api/stats', async (_req: Request, res: Response) => {
  const argusStats = getStats();
  let evolutionStats = null;
  
  if (evolutionDbReady) {
    evolutionStats = await getEvolutionStats(config.evolutionInstanceName);
  }
  
  res.json({
    ...argusStats,
    evolution: evolutionStats,
  });
});

// Get events (with status filter)
app.get('/api/events', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;
  const status = (req.query.status as string) || 'all';
  
  const events = getAllEvents({ 
    limit, 
    offset, 
    status: status as 'pending' | 'completed' | 'expired' | 'all' 
  });
  res.json(events);
});

// Get single event
app.get('/api/events/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const event = getEventById(id);
  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }
  res.json(event);
});

// Complete event
app.post('/api/events/:id/complete', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  completeEvent(id);
  broadcast({ type: 'event_updated', eventId: id, status: 'completed' });
  res.json({ success: true });
});

// Delete event (reject)
app.delete('/api/events/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  deleteEvent(id);
  broadcast({ type: 'event_deleted', eventId: id });
  res.json({ success: true });
});

// ============ Enhanced Event Flow Endpoints ============

// Set reminder for an event (user accepts in popup type 1)
// Changes status from 'discovered' to 'scheduled' and sets reminder_time
app.post('/api/events/:id/set-reminder', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const event = getEventById(id);
  
  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }
  
  scheduleEventReminder(id);
  broadcast({ type: 'event_scheduled', eventId: id });
  res.json({ success: true, message: 'Reminder scheduled for 1 hour before event' });
});

// Dismiss event (temporary - can reappear for context triggers)
app.post('/api/events/:id/dismiss', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const { permanent, urlPattern } = req.body;
  
  dismissContextEvent(id, urlPattern || '', permanent === true);
  broadcast({ type: 'event_dismissed', eventId: id, permanent });
  res.json({ success: true });
});

// Acknowledge reminder (user saw 1-hour reminder)
app.post('/api/events/:id/acknowledge', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  // Status stays 'reminded' - user can still complete it later
  broadcast({ type: 'event_acknowledged', eventId: id });
  res.json({ success: true, message: 'Reminder acknowledged' });
});

// Mark event as done (final completion)
app.post('/api/events/:id/done', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  updateEventStatus(id, 'completed');
  broadcast({ type: 'event_completed', eventId: id });
  res.json({ success: true, message: 'Event marked as done' });
});

// Set context URL for an event (for URL-based triggers like Netflix)
app.post('/api/events/:id/context-url', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const { url } = req.body;
  
  if (!url) {
    res.status(400).json({ error: 'URL required' });
    return;
  }
  
  setEventContextUrl(id, url);
  res.json({ success: true, message: 'Context URL set' });
});

// Get events by status (for extension to fetch discovered events)
app.get('/api/events/status/:status', (req: Request, res: Response) => {
  const status = req.params.status as string;
  const limit = parseInt(req.query.limit as string) || 50;
  const events = getEventsByStatus(status, limit);
  res.json(events);
});

// ============ Messages API (Argus local DB) ============
app.get('/api/messages', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;
  const sender = req.query.sender as string;
  
  const messages = getAllMessages({ limit, offset, sender });
  res.json(messages);
});

// ============ Evolution API (WhatsApp PostgreSQL) ============

// Get WhatsApp messages from Evolution
app.get('/api/whatsapp/messages', async (req: Request, res: Response) => {
  if (!evolutionDbReady) {
    res.status(503).json({ error: 'Evolution DB not connected' });
    return;
  }
  
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;
  const fromMe = req.query.fromMe === 'true' ? true : req.query.fromMe === 'false' ? false : null;
  const isGroup = req.query.isGroup === 'true' ? true : req.query.isGroup === 'false' ? false : null;
  const search = req.query.search as string;
  
  const messages = await getEvolutionMessages({
    instanceId: resolvedInstanceId || undefined,
    limit,
    offset,
    fromMe,
    isGroup,
    search,
  });
  
  res.json(messages);
});

// Search WhatsApp messages
app.get('/api/whatsapp/search', async (req: Request, res: Response) => {
  if (!evolutionDbReady) {
    res.status(503).json({ error: 'Evolution DB not connected' });
    return;
  }
  
  const query = req.query.q as string;
  if (!query) {
    res.status(400).json({ error: 'Query parameter q required' });
    return;
  }
  
  const limit = parseInt(req.query.limit as string) || 20;
  const messages = await searchEvolutionMessages(query, limit);
  res.json(messages);
});

// Get WhatsApp contacts from Evolution
app.get('/api/whatsapp/contacts', async (req: Request, res: Response) => {
  if (!evolutionDbReady) {
    res.status(503).json({ error: 'Evolution DB not connected' });
    return;
  }
  
  const limit = parseInt(req.query.limit as string) || 100;
  const contacts = await getEvolutionContacts(resolvedInstanceId || undefined, limit);
  res.json(contacts);
});

// Get WhatsApp chats from Evolution
app.get('/api/whatsapp/chats', async (req: Request, res: Response) => {
  if (!evolutionDbReady) {
    res.status(503).json({ error: 'Evolution DB not connected' });
    return;
  }
  
  const limit = parseInt(req.query.limit as string) || 50;
  const chats = await getEvolutionChats(resolvedInstanceId || undefined, limit);
  res.json(chats);
});

// Get WhatsApp instances
app.get('/api/whatsapp/instances', async (_req: Request, res: Response) => {
  if (!evolutionDbReady) {
    res.status(503).json({ error: 'Evolution DB not connected' });
    return;
  }
  
  const instances = await getEvolutionInstances();
  res.json(instances);
});

// Get WhatsApp stats
app.get('/api/whatsapp/stats', async (_req: Request, res: Response) => {
  if (!evolutionDbReady) {
    res.status(503).json({ error: 'Evolution DB not connected' });
    return;
  }
  
  const stats = await getEvolutionStats(resolvedInstanceId || undefined);
  res.json(stats);
});

// WhatsApp webhook
app.post('/api/webhook/whatsapp', async (req: Request, res: Response) => {
  try {
    // Only process messages.upsert events (new messages)
    // Ignore messages.update (read receipts, status updates)
    if (req.body.event !== 'messages.upsert') {
      res.json({ skipped: true, reason: 'event_type_ignored', event: req.body.event });
      return;
    }

    const parsed = WhatsAppWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
      return;
    }

    const result = await processWebhook(parsed.data, {
      processOwnMessages: config.processOwnMessages,
      skipGroupMessages: config.skipGroupMessages,
    });

    // Broadcast each event to WebSocket clients for overlay notifications
    if (result.eventsCreated > 0 && result.events) {
      for (const event of result.events) {
        broadcast({ type: 'notification', event });
      }
    }

    res.json(result);
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Context check (from Chrome extension)
app.post('/api/context-check', async (req: Request, res: Response) => {
  try {
    const parsed = ContextCheckRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });
      return;
    }

    // First check for URL-based context triggers (Netflix scenario)
    const contextTriggers = checkContextTriggers(parsed.data.url);
    
    if (contextTriggers.length > 0) {
      // Broadcast context reminders to all clients
      for (const trigger of contextTriggers) {
        broadcast({ 
          type: 'context_reminder', 
          event: trigger,
          popupType: 'context_reminder',
          url: parsed.data.url
        });
      }
    }

    // Also do keyword-based matching
    const result = await matchContext(
      parsed.data.url,
      parsed.data.title,
      config.hotWindowDays
    );

    // Return context triggers directly in response (for extension to show popups)
    res.json({
      ...result,
      contextTriggers: contextTriggers,  // Return full event objects
      contextTriggersCount: contextTriggers.length,
    });
  } catch (error) {
    console.error('Context check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Quick context extraction (for extension)
app.post('/api/extract-context', (req: Request, res: Response) => {
  try {
    const { url, title } = req.body;
    if (!url) {
      res.status(400).json({ error: 'URL required' });
      return;
    }
    const context = extractContextFromUrl(url, title);
    res.json(context);
  } catch (_error) {
    res.status(500).json({ error: 'Failed to extract context' });
  }
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  stopScheduler();
  closeDb();
  await closeEvolutionDb();
  server.close(() => {
    console.log('👋 Goodbye!');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM...');
  stopScheduler();
  closeDb();
  await closeEvolutionDb();
  server.close(() => process.exit(0));
});

// Start server
server.listen(config.port, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║     █████╗ ██████╗  ██████╗ ██╗   ██╗███████╗            ║
║    ██╔══██╗██╔══██╗██╔════╝ ██║   ██║██╔════╝            ║
║    ███████║██████╔╝██║  ███╗██║   ██║███████╗            ║
║    ██╔══██║██╔══██╗██║   ██║██║   ██║╚════██║            ║
║    ██║  ██║██║  ██║╚██████╔╝╚██████╔╝███████║            ║
║    ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚══════╝            ║
║                                                           ║
║    Proactive Memory Assistant v1.0.0                      ║
║    Model: ${config.geminiModel.padEnd(30)}        ║
║    Port:  ${config.port.toString().padEnd(30)}        ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

export { app, server };
