import { 
  getUnfiredTriggersByType, 
  markTriggerFired, 
  getEventById, 
  updateEventStatus,
  getDueReminders,
  markEventReminded,
  getContextEventsForUrl
} from './db.js';

// Extended notification with popup type
interface NotificationPayload {
  id: number;
  title: string;
  description: string | null;
  event_time?: number | null;
  location?: string | null;
  event_type?: string;
  triggerType: string;
  popupType: 'event_discovery' | 'event_reminder' | 'context_reminder' | 'conflict_warning' | 'insight_card';
}

type NotifyCallback = (event: NotificationPayload) => void;

let schedulerInterval: NodeJS.Timeout | null = null;
let reminderInterval: NodeJS.Timeout | null = null;
let notifyCallback: NotifyCallback | null = null;

export function startScheduler(callback: NotifyCallback, intervalMs = 60000): void {
  notifyCallback = callback;
  
  // Run immediately
  checkTimeTriggers();
  checkDueReminders();
  
  // Then run periodically
  schedulerInterval = setInterval(checkTimeTriggers, intervalMs);
  reminderInterval = setInterval(checkDueReminders, 30000); // Check reminders every 30 seconds
  
  console.log('⏰ Scheduler started (triggers every', intervalMs / 1000, 's, reminders every 30s)');
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
  }
  console.log('⏰ Scheduler stopped');
}

// Check for 1-hour-before reminders
function checkDueReminders(): void {
  const dueReminders = getDueReminders();
  
  for (const event of dueReminders) {
    if (notifyCallback && event.id) {
      notifyCallback({
        id: event.id,
        title: event.title,
        description: event.description,
        event_time: event.event_time,
        location: event.location,
        event_type: event.event_type,
        triggerType: 'reminder_1hr',
        popupType: 'event_reminder',
      });
      
      console.log(`🔔 1-hour reminder fired: ${event.title}`);
    }
    
    // Mark as reminded so it doesn't fire again
    if (event.id) {
      markEventReminded(event.id);
    }
  }
}

// Check for context URL triggers (called when user visits a URL)
export function checkContextTriggers(url: string): NotificationPayload[] {
  const events = getContextEventsForUrl(url);
  const notifications: NotificationPayload[] = [];
  
  for (const event of events) {
    if (event.id) {
      notifications.push({
        id: event.id,
        title: event.title,
        description: event.description,
        event_time: event.event_time,
        location: event.location,
        event_type: event.event_type,
        triggerType: 'url',
        popupType: 'context_reminder',
      });
    }
  }
  
  return notifications;
}

function checkTimeTriggers(): void {
  const now = Date.now();
  const triggers = getUnfiredTriggersByType('time');
  
  for (const trigger of triggers) {
    try {
      const triggerTime = new Date(trigger.trigger_value).getTime();
      
      // Check if trigger time has passed (with 5 min buffer)
      if (triggerTime <= now + 5 * 60 * 1000) {
        const event = getEventById(trigger.event_id);
        
        if (event && (event.status === 'pending' || event.status === 'scheduled')) {
          // Fire notification
          if (notifyCallback) {
            notifyCallback({
              id: event.id!,
              title: event.title,
              description: event.description,
              event_time: event.event_time,
              location: event.location,
              event_type: event.event_type,
              triggerType: 'time',
              popupType: 'event_reminder',
            });
          }
          
          console.log(`🔔 Time trigger fired: ${event.title}`);
        }
        
        markTriggerFired(trigger.id!);
      }
    } catch (error) {
      console.error(`Failed to process trigger ${trigger.id}:`, error);
    }
  }
}

// Mark event as completed
export function completeEvent(eventId: number): void {
  updateEventStatus(eventId, 'completed');
  console.log(`✅ Event ${eventId} marked as completed`);
}

// Mark event as expired
export function expireEvent(eventId: number): void {
  updateEventStatus(eventId, 'expired');
  console.log(`⏳ Event ${eventId} marked as expired`);
}

// Cleanup old events (run daily)
export function cleanupOldEvents(_daysOld = 90): number {
  // const cutoff = Math.floor(Date.now() / 1000) - _daysOld * 24 * 60 * 60;
  
  // This would need a new db function, but for simplicity we'll skip
  // In production, you'd want to archive or delete old events
  
  return 0;
}
