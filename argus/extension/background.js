// Argus Background Service Worker v2.1
// Handles: WebSocket connection, API calls, context triggers, reminder flow
// NOTE: All popups are shown via content.js overlay - NO Chrome notifications

const API_BASE = 'http://localhost:3000';
const WS_URL = 'ws://localhost:3000';

let ws = null;
let reconnectAttempts = 0;
let lastCheckedUrl = '';
let contextCheckTimer = null;

// Store dismissed context reminders temporarily (per session)
const dismissedEvents = new Map(); // eventId -> timestamp

// ============ UTILITY FUNCTIONS ============

function debounce(func, wait) {
  return function executedFunction(...args) {
    clearTimeout(contextCheckTimer);
    contextCheckTimer = setTimeout(() => func.apply(this, args), wait);
  };
}

function isEventDismissed(eventId) {
  const dismissedTime = dismissedEvents.get(eventId);
  if (!dismissedTime) return false;
  
  // Dismissed for 30 minutes
  const DISMISS_DURATION = 30 * 60 * 1000;
  return (Date.now() - dismissedTime) < DISMISS_DURATION;
}

function dismissEvent(eventId) {
  dismissedEvents.set(eventId, Date.now());
}

// ============ WEBSOCKET CONNECTION ============

function connectWebSocket() {
  try {
    ws = new WebSocket(WS_URL);
    
    ws.onopen = function() {
      console.log('[Argus] WebSocket connected');
      reconnectAttempts = 0;
    };
    
    ws.onmessage = function(event) {
      try {
        const data = JSON.parse(event.data);
        console.log('[Argus] WS message:', data.type);
        handleWebSocketMessage(data);
      } catch (e) {
        console.error('[Argus] WS parse error:', e);
      }
    };
    
    ws.onclose = function() {
      console.log('[Argus] WebSocket disconnected');
      const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts));
      reconnectAttempts++;
      setTimeout(connectWebSocket, delay);
    };
    
    ws.onerror = function(error) {
      console.error('[Argus] WebSocket error:', error);
    };
  } catch (e) {
    console.error('[Argus] Failed to create WebSocket:', e);
  }
}

// ============ WEBSOCKET MESSAGE HANDLERS ============

async function handleWebSocketMessage(data) {
  switch (data.type) {
    case 'notification':
      // New event discovered from WhatsApp - show discovery popup
      console.log('[Argus] New event discovered:', data.event?.title);
      await sendToActiveTab({
        type: 'ARGUS_NEW_EVENT',
        event: data.event,
      });
      break;
      
    case 'context_reminder':
      // Context reminder - already handled by API response in checkCurrentUrl()
      console.log('[Argus] Context reminder (handled by API):', data.event?.title);
      break;
      
    case 'trigger':
      // Scheduled reminder triggered (1 hour before event)
      console.log('[Argus] Scheduled reminder:', data.event?.title || data.message);
      await sendToActiveTab({
        type: 'ARGUS_REMINDER',
        event: data.event || { title: data.message },
        message: data.message,
      });
      break;
      
    case 'event_updated':
    case 'event_scheduled':
    case 'event_completed':
    case 'event_deleted':
    case 'event_dismissed':
      console.log('[Argus] Event status changed:', data.type, data.eventId);
      break;
  }
}

// ============ TAB COMMUNICATION ============

async function sendToActiveTab(message) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0] && tabs[0].id && !tabs[0].url?.startsWith('chrome://')) {
      console.log('[Argus] Sending to tab:', tabs[0].id, message.type);
      await chrome.tabs.sendMessage(tabs[0].id, message);
      console.log('[Argus] Message sent successfully');
      return true;
    }
  } catch (err) {
    console.log('[Argus] Could not send to tab:', err.message);
  }
  return false;
}

async function sendToAllTabs(message) {
  const tabs = await chrome.tabs.query({});
  let sent = 0;
  for (const tab of tabs) {
    if (tab.id && !tab.url?.startsWith('chrome://')) {
      try {
        await chrome.tabs.sendMessage(tab.id, message);
        sent++;
      } catch (e) {
        // Content script not loaded
      }
    }
  }
  console.log('[Argus] Sent to', sent, 'tabs');
  return sent;
}

// ============ CONTEXT CHECK (URL-based triggers) ============

async function checkCurrentUrl(url, title) {
  // Skip internal URLs
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
    return;
  }

  // Skip if same as last URL (prevent duplicate checks)
  if (url === lastCheckedUrl) return;
  lastCheckedUrl = url;

  console.log('[Argus] Checking URL:', url);

  try {
    const response = await fetch(API_BASE + '/api/context-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, title }),
    });

    if (!response.ok) {
      console.error('[Argus] Context check failed:', response.status);
      return;
    }

    const result = await response.json();

    // Handle URL-based context triggers (Netflix scenario)
    if (result.contextTriggers && result.contextTriggers.length > 0) {
      console.log('[Argus] Found', result.contextTriggers.length, 'context triggers');
      
      for (const event of result.contextTriggers) {
        if (!isEventDismissed(event.id)) {
          console.log('[Argus] Showing context reminder:', event.id, event.title);
          await sendToActiveTab({
            type: 'ARGUS_CONTEXT_REMINDER',
            event: event,
            url: url,
          });
        }
      }
    }

    // Handle keyword-based matches
    if (result.matched && result.events && result.events.length > 0) {
      console.log('[Argus] Found', result.events.length, 'keyword matches');
      
      for (const event of result.events) {
        if (!isEventDismissed(event.id)) {
          await sendToActiveTab({
            type: 'ARGUS_CONTEXT_REMINDER',
            event: event,
            url: url,
          });
        }
      }
    }
  } catch (error) {
    console.error('[Argus] Context check error:', error.message);
  }
}

const debouncedUrlCheck = debounce(checkCurrentUrl, 1000);

// ============ TAB LISTENERS ============

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
  if (changeInfo.status === 'complete' && tab.url && tab.active) {
    debouncedUrlCheck(tab.url, tab.title);
  }
});

chrome.tabs.onActivated.addListener(async function(activeInfo) {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
      debouncedUrlCheck(tab.url, tab.title);
    }
  } catch (e) {
    // Tab might be closed
  }
});

// ============ MESSAGE HANDLERS (from content script & popup) ============

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  console.log('[Argus] Message from content:', message.type);
  
  const handleAsync = async () => {
    try {
      switch (message.type) {
        case 'SET_REMINDER':
          const setRes = await fetch(API_BASE + '/api/events/' + message.eventId + '/set-reminder', { method: 'POST' });
          return await setRes.json();
          
        case 'ACKNOWLEDGE_REMINDER':
          const ackRes = await fetch(API_BASE + '/api/events/' + message.eventId + '/acknowledge', { method: 'POST' });
          return await ackRes.json();
          
        case 'MARK_DONE':
          const doneRes = await fetch(API_BASE + '/api/events/' + message.eventId + '/done', { method: 'POST' });
          return await doneRes.json();
          
        case 'DISMISS_EVENT':
          if (!message.permanent) {
            dismissEvent(message.eventId);
          }
          const dismissRes = await fetch(API_BASE + '/api/events/' + message.eventId + '/dismiss', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              permanent: message.permanent,
              urlPattern: message.url,
            }),
          });
          return await dismissRes.json();
          
        case 'DELETE_EVENT':
          const delRes = await fetch(API_BASE + '/api/events/' + message.eventId, { method: 'DELETE' });
          return await delRes.json();
          
        case 'COMPLETE_EVENT':
          const compRes = await fetch(API_BASE + '/api/events/' + message.eventId + '/complete', { method: 'POST' });
          return await compRes.json();
          
        case 'OPEN_DASHBOARD':
          chrome.tabs.create({ url: 'http://localhost:3000' });
          return { success: true };
          
        case 'GET_STATS':
          const statsRes = await fetch(API_BASE + '/api/stats');
          return await statsRes.json();

        case 'GET_EVENTS':
          const eventsRes = await fetch(API_BASE + '/api/events?limit=10');
          return await eventsRes.json();
          
        default:
          return { error: 'Unknown message type' };
      }
    } catch (error) {
      console.error('[Argus] API error:', error);
      return { error: error.message };
    }
  };
  
  handleAsync().then(sendResponse);
  return true; // Keep channel open for async response
});

// ============ STARTUP ============

chrome.runtime.onInstalled.addListener(async function() {
  console.log('[Argus] Extension installed/updated');
  try {
    const response = await fetch(API_BASE + '/api/health');
    if (response.ok) {
      console.log('[Argus] Backend connected ✅');
    }
  } catch (e) {
    console.log('[Argus] Backend not running. Start with: npm run dev');
  }
  connectWebSocket();
});

// Connect on startup
connectWebSocket();

console.log('[Argus] Background Service Worker v2.1 loaded');
