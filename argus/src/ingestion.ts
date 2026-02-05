import { insertMessage, insertEvent, insertTrigger, getRecentMessages, upsertContact } from './db.js';
import { extractEvents, classifyMessage } from './gemini.js';
import type { Message, WhatsAppWebhook } from './types.js';

interface CreatedEvent {
  id: number;
  event_type: string;
  title: string;
  description: string | null;
  event_time: number | null;
  location: string | null;
  participants: string;
  keywords: string;
  confidence: number;
  context_url?: string | null;
}

interface IngestionResult {
  messageId: string;
  eventsCreated: number;
  triggersCreated: number;
  skipped: boolean;
  skipReason?: string;
  events?: CreatedEvent[];
}

export async function processWebhook(
  payload: WhatsAppWebhook,
  options: { processOwnMessages: boolean; skipGroupMessages: boolean }
): Promise<IngestionResult> {
  const { data } = payload;
  
  // Extract message content
  const content = data.message?.conversation || data.message?.extendedTextMessage?.text;
  if (!content) {
    return { messageId: data.key.id, eventsCreated: 0, triggersCreated: 0, skipped: true, skipReason: 'no_content' };
  }

  // Check if from self
  if (data.key.fromMe && !options.processOwnMessages) {
    return { messageId: data.key.id, eventsCreated: 0, triggersCreated: 0, skipped: true, skipReason: 'own_message' };
  }

  // Check if group
  const isGroup = data.key.remoteJid.includes('@g.us');
  if (isGroup && options.skipGroupMessages) {
    return { messageId: data.key.id, eventsCreated: 0, triggersCreated: 0, skipped: true, skipReason: 'group_message' };
  }

  // Create message object
  const timestamp = typeof data.messageTimestamp === 'string' 
    ? parseInt(data.messageTimestamp) 
    : data.messageTimestamp;

  const message: Message = {
    id: data.key.id,
    chat_id: data.key.remoteJid,
    sender: data.key.fromMe ? 'self' : data.key.remoteJid.split('@')[0],
    content,
    timestamp,
  };

  // Store message
  insertMessage(message);

  // Update contact
  upsertContact({
    id: message.sender,
    name: data.pushName || null,
    first_seen: timestamp,
    last_seen: timestamp,
    message_count: 1,
  });

  // Quick classification
  const classification = await classifyMessage(content);
  if (!classification.hasEvent) {
    return { messageId: message.id, eventsCreated: 0, triggersCreated: 0, skipped: true, skipReason: 'no_event_detected' };
  }

  // Get context from recent messages
  const recentMessages = getRecentMessages(message.chat_id, 5);
  const context = recentMessages
    .filter(m => m.id !== message.id)
    .map(m => m.content);

  // Extract events
  const result = await processMessage(message, context);
  
  return result;
}

export async function processMessage(
  message: Message,
  context: string[] = []
): Promise<IngestionResult> {
  let eventsCreated = 0;
  let triggersCreated = 0;
  const createdEvents: CreatedEvent[] = [];

  try {
    // Extract events using Gemini
    const extraction = await extractEvents(message.content, context);

    for (const event of extraction.events) {
      if (event.confidence < 0.4) continue; // Skip low confidence

      // Parse event time
      let eventTime: number | null = null;
      if (event.event_time) {
        try {
          eventTime = Math.floor(new Date(event.event_time).getTime() / 1000);
        } catch {
          eventTime = null;
        }
      }

      // Determine context_url for subscription types (Netflix, Amazon, etc.)
      let contextUrl: string | null = null;
      if (event.type === 'subscription' && event.location) {
        // Extract domain from location if it looks like a URL
        const locationLower = event.location.toLowerCase();
        if (locationLower.includes('.com') || locationLower.includes('.in') || locationLower.includes('.org')) {
          contextUrl = locationLower.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
        } else {
          // Map known services to their domains
          const serviceDomains: Record<string, string> = {
            'netflix': 'netflix.com',
            'amazon prime': 'amazon.com',
            'amazon': 'amazon.com',
            'prime video': 'primevideo.com',
            'hotstar': 'hotstar.com',
            'disney': 'disneyplus.com',
            'spotify': 'spotify.com',
            'youtube': 'youtube.com',
            'gym': 'gym',
            'subscription': '',
          };
          for (const [service, domain] of Object.entries(serviceDomains)) {
            if (locationLower.includes(service) && domain) {
              contextUrl = domain;
              break;
            }
          }
        }
      }

      // Insert event with 'discovered' status - user needs to approve and set reminder
      const eventData = {
        message_id: message.id,
        event_type: event.type,
        title: event.title,
        description: event.description,
        event_time: eventTime,
        location: event.location,
        participants: JSON.stringify(event.participants),
        keywords: event.keywords.join(','),
        confidence: event.confidence,
        status: 'discovered' as const,
        context_url: contextUrl,
      };
      const eventId = insertEvent(eventData);
      eventsCreated++;
      
      // Track for return
      createdEvents.push({
        id: eventId,
        event_type: event.type,
        title: event.title,
        description: event.description,
        event_time: eventTime,
        location: event.location,
        participants: JSON.stringify(event.participants),
        keywords: event.keywords.join(','),
        confidence: event.confidence,
        context_url: contextUrl,
      });

      // Create triggers
      // Time-based trigger
      if (eventTime) {
        insertTrigger({
          event_id: eventId,
          trigger_type: 'time',
          trigger_value: new Date(eventTime * 1000).toISOString(),
          is_fired: false,
        });
        triggersCreated++;
      }

      // Location/URL triggers
      if (event.location) {
        insertTrigger({
          event_id: eventId,
          trigger_type: 'url',
          trigger_value: event.location.toLowerCase(),
          is_fired: false,
        });
        triggersCreated++;
      }

      // Keyword triggers (for important keywords)
      const importantKeywords = event.keywords.filter(kw => 
        ['travel', 'flight', 'hotel', 'buy', 'gift', 'birthday', 'meeting', 'deadline'].some(ik => kw.toLowerCase().includes(ik))
      );
      for (const kw of importantKeywords.slice(0, 3)) {
        insertTrigger({
          event_id: eventId,
          trigger_type: 'keyword',
          trigger_value: kw.toLowerCase(),
          is_fired: false,
        });
        triggersCreated++;
      }
    }

    console.log(`📥 Processed message ${message.id}: ${eventsCreated} events, ${triggersCreated} triggers`);
    
  } catch (error) {
    console.error(`❌ Failed to process message ${message.id}:`, error);
  }

  return { messageId: message.id, eventsCreated, triggersCreated, skipped: false, events: createdEvents };
}

// Batch import for initial data load
export async function batchImportMessages(
  messages: Array<{ content: string; sender: string; chatId: string; timestamp: number }>
): Promise<{ total: number; processed: number; events: number }> {
  let processed = 0;
  let totalEvents = 0;

  for (const msg of messages) {
    const message: Message = {
      id: `import_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      chat_id: msg.chatId,
      sender: msg.sender,
      content: msg.content,
      timestamp: msg.timestamp,
    };

    insertMessage(message);

    const classification = await classifyMessage(msg.content);
    if (classification.hasEvent) {
      const result = await processMessage(message);
      totalEvents += result.eventsCreated;
      processed++;
    }
  }

  return { total: messages.length, processed, events: totalEvents };
}
