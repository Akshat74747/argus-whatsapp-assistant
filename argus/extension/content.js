// Argus Content Script v2.2
// In-page overlay popups for event notifications
// Popup Types: event_discovery, event_reminder, context_reminder, conflict_warning, insight_card

(function() {
  'use strict';
  
  // Track dismissed/handled events (persisted for session)
  const dismissedEventIds = new Set();
  const handledEventIds = new Set();

  // ============ STYLES ============
  const STYLES = `
    /* Reset for Argus elements */
    #argus-modal-backdrop,
    #argus-modal-backdrop * {
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
    }

    /* Modal Backdrop */
    #argus-modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: argus-fade-in 0.25s ease-out;
    }

    @keyframes argus-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes argus-scale-in {
      from { transform: scale(0.9) translateY(-20px); opacity: 0; }
      to { transform: scale(1) translateY(0); opacity: 1; }
    }

    @keyframes argus-scale-out {
      from { transform: scale(1); opacity: 1; }
      to { transform: scale(0.9); opacity: 0; }
    }

    /* Modal Container */
    #argus-modal {
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5);
      max-width: 420px;
      width: 92%;
      overflow: hidden;
      animation: argus-scale-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    #argus-modal.hiding {
      animation: argus-scale-out 0.2s ease-in forwards;
    }

    /* Header */
    .argus-header {
      padding: 24px 24px 20px;
      position: relative;
      color: white;
    }

    .argus-header.discovery { background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); }
    .argus-header.reminder { background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%); }
    .argus-header.context { background: linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%); }
    .argus-header.conflict { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); }
    .argus-header.insight { background: linear-gradient(135deg, #10b981 0%, #059669 100%); }

    .argus-close-btn {
      position: absolute;
      top: 12px;
      right: 12px;
      background: rgba(255, 255, 255, 0.2);
      border: none;
      color: white;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
    }

    .argus-close-btn:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    .argus-icon {
      width: 56px;
      height: 56px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 12px;
      font-size: 28px;
    }

    .argus-title {
      font-size: 20px;
      font-weight: 700;
      text-align: center;
      margin: 0 0 4px;
    }

    .argus-subtitle {
      font-size: 13px;
      text-align: center;
      opacity: 0.9;
    }

    /* Body */
    .argus-body {
      padding: 20px 24px 24px;
    }

    .argus-event-title {
      font-size: 17px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 6px;
      line-height: 1.3;
    }

    .argus-event-desc {
      font-size: 14px;
      color: #6b7280;
      line-height: 1.5;
      margin-bottom: 16px;
    }

    .argus-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 20px;
    }

    .argus-meta-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #f3f4f6;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      color: #4b5563;
    }

    .argus-meta-item span {
      font-size: 14px;
    }

    .argus-question {
      background: #f9fafb;
      border: 1px dashed #d1d5db;
      border-radius: 10px;
      padding: 14px;
      text-align: center;
      font-size: 14px;
      color: #4b5563;
      margin-bottom: 20px;
    }

    /* Actions */
    .argus-actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .argus-actions-row {
      display: flex;
      gap: 10px;
    }

    .argus-btn {
      flex: 1;
      padding: 12px 20px;
      border: none;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }

    .argus-btn:hover {
      transform: translateY(-1px);
    }

    .argus-btn:active {
      transform: translateY(0);
    }

    .argus-btn-primary {
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      color: white;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
    }

    .argus-btn-primary:hover {
      box-shadow: 0 6px 16px rgba(99, 102, 241, 0.4);
    }

    .argus-btn-success {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
    }

    .argus-btn-secondary {
      background: #f3f4f6;
      color: #4b5563;
    }

    .argus-btn-secondary:hover {
      background: #e5e7eb;
    }

    .argus-btn-outline {
      background: transparent;
      border: 1px solid #e5e7eb;
      color: #6b7280;
    }

    .argus-btn-outline:hover {
      background: #f9fafb;
      border-color: #d1d5db;
    }

    /* Footer */
    .argus-footer {
      padding: 12px 24px;
      text-align: center;
      background: #f9fafb;
      border-top: 1px solid #f3f4f6;
    }

    .argus-powered {
      font-size: 11px;
      color: #9ca3af;
    }

    .argus-powered strong {
      color: #6366f1;
    }

    /* Toast Notifications */
    #argus-toast-container {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483646;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    }

    .argus-toast {
      background: #1f2937;
      border-radius: 10px;
      padding: 14px 18px;
      min-width: 280px;
      max-width: 360px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
      color: #f9fafb;
      pointer-events: all;
      animation: argus-slide-in 0.3s ease-out;
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }

    @keyframes argus-slide-in {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    .argus-toast.hiding {
      animation: argus-slide-out 0.2s ease-in forwards;
    }

    @keyframes argus-slide-out {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(100%); opacity: 0; }
    }

    .argus-toast-icon {
      font-size: 20px;
      flex-shrink: 0;
    }

    .argus-toast-content {
      flex: 1;
    }

    .argus-toast-title {
      font-weight: 600;
      font-size: 14px;
      margin-bottom: 2px;
    }

    .argus-toast-desc {
      font-size: 12px;
      color: #9ca3af;
    }

    .argus-toast-close {
      background: none;
      border: none;
      color: #6b7280;
      cursor: pointer;
      font-size: 16px;
      padding: 0;
      flex-shrink: 0;
    }

    .argus-toast-close:hover {
      color: #f9fafb;
    }
  `;

  // ============ STATE ============
  let styleElement = null;
  let currentModal = null;
  let toastContainer = null;
  const shownEventIds = new Set();

  // ============ MODAL CONFIGURATION ============
  // Dynamic - uses event data to build human-readable messages
  function getModalConfig(popupType, event, extraData) {
    const sender = event.sender_name || 'Someone';
    const eventType = event.event_type || 'other';

    switch (popupType) {
      case 'event_discovery':
        return {
          icon: eventType === 'recommendation' ? '💡' : eventType === 'subscription' ? '💳' : eventType === 'meeting' ? '📅' : eventType === 'task' ? '📝' : '📅',
          headerClass: eventType === 'recommendation' ? 'insight' : 'discovery',
          title: eventType === 'recommendation' ? 'Remember This?' :
                 eventType === 'subscription' ? 'Subscription Alert!' :
                 eventType === 'meeting' ? 'New Event Detected!' :
                 'New Event Detected!',
          subtitle: sender !== 'Someone' ? 'From your chat with ' + sender : 'From your WhatsApp messages',
          question: eventType === 'recommendation' ? 'Want to save this for later?' :
                    eventType === 'subscription' ? 'Want to set a reminder for this?' :
                    'Would you like to set a reminder?',
          buttons: [
            { text: '⏰ Set Reminder', action: 'set-reminder', style: 'primary' },
            { text: '💤 Later', action: 'snooze', style: 'secondary' },
            { text: '🚫 Not Interested', action: 'ignore', style: 'outline' },
          ]
        };

      case 'event_reminder':
        return {
          icon: '⏰',
          headerClass: 'reminder',
          title: 'Event Starting Soon!',
          subtitle: sender !== 'Someone' ? sender + ' mentioned this' : 'This is your scheduled reminder',
          question: null,
          buttons: [
            { text: '✓ Got It', action: 'acknowledge', style: 'primary' },
            { text: '✅ Mark Done', action: 'done', style: 'success' },
            { text: '💤 Snooze 30min', action: 'snooze', style: 'secondary' },
          ]
        };

      case 'context_reminder':
        // Build smart message based on event type
        let contextTitle = 'Remember This?';
        let contextSubtitle = 'From your messages';
        let contextQuestion = 'Would you like to take action now?';
        let contextButtons = [
          { text: '✅ Done', action: 'done', style: 'success' },
          { text: '💤 Not Now', action: 'dismiss-temp', style: 'secondary' },
          { text: "🚫 Never Show", action: 'dismiss-permanent', style: 'outline' },
        ];

        if (eventType === 'subscription') {
          contextTitle = '💳 Subscription Alert!';
          contextSubtitle = 'You planned to take action on this';
          contextQuestion = 'You\'re on this site right now. Want to take action?';
          contextButtons = [
            { text: '✅ Already Done', action: 'done', style: 'success' },
            { text: '💤 Remind Later', action: 'dismiss-temp', style: 'secondary' },
            { text: "🚫 Cancel Reminder", action: 'dismiss-permanent', style: 'outline' },
          ];
        } else if (eventType === 'recommendation' || eventType === 'travel') {
          contextTitle = '💡 ' + (sender !== 'Someone' ? sender + '\'s Recommendation' : 'Recommendation');
          contextSubtitle = sender !== 'Someone' ? 'From your chat with ' + sender : 'From your conversations';
          contextQuestion = 'You\'re browsing related content right now!';
          contextButtons = [
            { text: '📍 Save Location', action: 'done', style: 'success' },
            { text: '💤 Not Now', action: 'dismiss-temp', style: 'secondary' },
            { text: "🚫 Not Interested", action: 'dismiss-permanent', style: 'outline' },
          ];
        }

        return {
          icon: eventType === 'subscription' ? '💳' : eventType === 'recommendation' ? '💡' : '🎯',
          headerClass: 'context',
          title: contextTitle,
          subtitle: contextSubtitle,
          question: contextQuestion,
          buttons: contextButtons,
        };

      case 'conflict_warning': {
        const conflicts = extraData.conflictingEvents || [];
        const conflictNames = conflicts.map(function(e) { return e.title; }).join(', ');
        // Build a human, conversational message
        let friendlyQuestion = 'You may have overlapping commitments.';
        if (conflicts.length === 1) {
          const c = conflicts[0];
          let cTime = '';
          if (c.event_time) {
            cTime = new Date(c.event_time * 1000).toLocaleDateString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' });
          }
          friendlyQuestion = 'You already have "' + c.title + '"' + (cTime ? ' on ' + cTime : '') + '. This new event will overlap — want to pick a different time?';
        } else if (conflicts.length > 1) {
          friendlyQuestion = 'Heads up! You already have ' + conflicts.length + ' things planned around this time (' + conflictNames + '). Want to find a better slot?';
        }
        return {
          icon: '🗓️',
          headerClass: 'conflict',
          title: 'Hmm, you might be double-booked',
          subtitle: sender !== 'Someone' ? sender + ' mentioned this — but you already have plans' : 'Let\'s sort out your schedule',
          question: friendlyQuestion,
          buttons: [
            { text: '� View My Day', action: 'view-day', style: 'primary' },
            { text: '✅ Keep Both', action: 'acknowledge', style: 'secondary' },
            { text: '🚫 Skip This One', action: 'ignore', style: 'outline' },
          ]
        };
      }

      case 'insight_card':
        return {
          icon: '💡',
          headerClass: 'insight',
          title: sender !== 'Someone' ? sender + '\'s Suggestion' : 'Suggestion',
          subtitle: 'Based on your conversations',
          question: null,
          buttons: [
            { text: '👍 Thanks!', action: 'acknowledge', style: 'primary' },
            { text: '🚫 Not Relevant', action: 'dismiss', style: 'secondary' },
          ]
        };

      default:
        return {
          icon: '📅',
          headerClass: 'discovery',
          title: 'New Event Detected!',
          subtitle: 'From your WhatsApp messages',
          question: 'Would you like to set a reminder?',
          buttons: [
            { text: '⏰ Set Reminder', action: 'set-reminder', style: 'primary' },
            { text: '💤 Later', action: 'snooze', style: 'secondary' },
            { text: '🚫 Not Interested', action: 'ignore', style: 'outline' },
          ]
        };
    }
  }

  // ============ INITIALIZATION ============
  function injectStyles() {
    if (styleElement) return;
    styleElement = document.createElement('style');
    styleElement.id = 'argus-styles';
    styleElement.textContent = STYLES;
    document.head.appendChild(styleElement);
  }

  function createToastContainer() {
    if (toastContainer) return toastContainer;
    toastContainer = document.createElement('div');
    toastContainer.id = 'argus-toast-container';
    document.body.appendChild(toastContainer);
    return toastContainer;
  }

  // ============ MODAL FUNCTIONS ============
  function showModal(event, popupType = 'event_discovery', extraData = {}) {
    // Prevent duplicate/dismissed modals
    if (event.id) {
      if (shownEventIds.has(event.id)) {
        console.log('[Argus] ⏭️ Modal already shown for event:', event.id);
        return;
      }
      if (dismissedEventIds.has(event.id)) {
        console.log('[Argus] ⏭️ Event dismissed, not showing:', event.id);
        return;
      }
      if (handledEventIds.has(event.id)) {
        console.log('[Argus] ⏭️ Event already handled, not showing:', event.id);
        return;
      }
    }

    console.log(`[Argus] 🎨 Showing popup: type="${popupType}", event="${event.title}" (id: ${event.id})`);
    
    injectStyles();

    // Close any existing modal
    if (currentModal) {
      currentModal.remove();
      currentModal = null;
    }

    if (event.id) {
      shownEventIds.add(event.id);
    }

    // Use API popup blueprint if available, otherwise fall back to local config
    // v2.6.0: Server sends complete popup spec via Gemini — extension just renders
    const config = extraData.popup || getModalConfig(popupType, event, extraData);

    // Create backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'argus-modal-backdrop';

    // Format event time
    let timeDisplay = null;
    if (event.event_time) {
      const eventDate = new Date(event.event_time * 1000);
      timeDisplay = eventDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    }

    // Build modal HTML
    let html = '<div id="argus-modal">';
    
    // Header
    html += '<div class="argus-header ' + config.headerClass + '">';
    html += '<button class="argus-close-btn" data-action="close">✕</button>';
    html += '<div class="argus-icon">' + config.icon + '</div>';
    html += '<h2 class="argus-title">' + config.title + '</h2>';
    html += '<p class="argus-subtitle">' + config.subtitle + '</p>';
    html += '</div>';

    // Body
    html += '<div class="argus-body">';
    html += '<div class="argus-event-title">' + escapeHtml(event.title || 'Untitled Event') + '</div>';
    
    if (event.description) {
      // Build smart description with sender attribution
      let desc = event.description;
      if (event.sender_name && !desc.toLowerCase().includes(event.sender_name.toLowerCase())) {
        desc = event.sender_name + ' mentioned: ' + desc;
      }
      html += '<div class="argus-event-desc">' + escapeHtml(desc) + '</div>';
    }

    // Meta info
    html += '<div class="argus-meta">';
    if (timeDisplay) {
      html += '<div class="argus-meta-item"><span>📅</span> ' + timeDisplay + '</div>';
    }
    if (event.location) {
      html += '<div class="argus-meta-item"><span>📍</span> ' + escapeHtml(event.location) + '</div>';
    }
    if (event.event_type) {
      html += '<div class="argus-meta-item"><span>🏷️</span> ' + escapeHtml(event.event_type) + '</div>';
    }
    html += '</div>';

    // Show conflicting events for conflict_warning popup
    if (popupType === 'conflict_warning' && extraData.conflictingEvents && extraData.conflictingEvents.length > 0) {
      html += '<div class="argus-question" style="background: #fff7ed; border-color: #fed7aa; color: #9a3412; border-radius: 10px; padding: 12px 16px;">';
      html += '<strong>📅 What\'s already on your plate:</strong><br><br>';
      extraData.conflictingEvents.forEach(function(conflict) {
        let conflictTime = '';
        if (conflict.event_time) {
          const d = new Date(conflict.event_time * 1000);
          conflictTime = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        }
        html += '&nbsp;&nbsp;→ ' + escapeHtml(conflict.title) + (conflictTime ? ' — ' + conflictTime : '') + '<br>';
      });
      html += '</div>';
    }

    // Question
    if (config.question) {
      html += '<div class="argus-question">' + config.question + '</div>';
    }

    // Action buttons
    if (event.id && config.buttons.length > 0) {
      html += '<div class="argus-actions">';
      html += '<div class="argus-actions-row">';
      config.buttons.slice(0, 2).forEach(function(btn) {
        html += '<button class="argus-btn argus-btn-' + btn.style + '" data-action="' + btn.action + '">' + btn.text + '</button>';
      });
      html += '</div>';
      if (config.buttons.length > 2) {
        html += '<button class="argus-btn argus-btn-' + config.buttons[2].style + '" data-action="' + config.buttons[2].action + '">' + config.buttons[2].text + '</button>';
      }
      html += '</div>';
    }

    html += '</div>'; // End body

    // Footer
    html += '<div class="argus-footer">';
    html += '<span class="argus-powered">Powered by <strong>Argus</strong></span>';
    html += '</div>';

    html += '</div>'; // End modal

    backdrop.innerHTML = html;
    document.body.appendChild(backdrop);
    currentModal = backdrop;

    // Event handlers
    backdrop.querySelectorAll('[data-action]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const action = this.getAttribute('data-action');
        if (action === 'close') {
          closeModal();
        } else {
          handleAction(action, event, popupType, extraData);
        }
      });
    });

    // Close on backdrop click (except for context reminders)
    if (popupType !== 'context_reminder') {
      backdrop.addEventListener('click', function(e) {
        if (e.target === backdrop) {
          closeModal();
        }
      });
    }

    console.log('[Argus] Modal shown:', popupType, event.title);
  }

  function closeModal() {
    if (!currentModal) return;

    const modal = currentModal.querySelector('#argus-modal');
    if (modal) {
      modal.classList.add('hiding');
    }

    const modalToRemove = currentModal;
    currentModal = null;

    setTimeout(function() {
      if (modalToRemove && modalToRemove.parentNode) {
        modalToRemove.remove();
      }
    }, 200);
  }

  function handleAction(action, event, popupType, extraData) {
    const eventId = event.id;
    console.log(`[Argus] 🔵 User action: "${action}" on event #${eventId} (popup: ${popupType})`);
    
    // Track this event as handled so we don't show it again
    if (eventId) {
      handledEventIds.add(eventId);
    }

    switch (action) {
      case 'set-reminder':
      case 'schedule':
        console.log(`[Argus] 📡 Sending SET_REMINDER message to background for event #${eventId}`);
        chrome.runtime.sendMessage({ type: 'SET_REMINDER', eventId: eventId });
        showToast('📅 Scheduled!', 'You will be reminded before the event.');
        break;

      case 'snooze':
        console.log(`[Argus] 📡 Sending SNOOZE for event #${eventId}`);
        chrome.runtime.sendMessage({ type: 'SNOOZE_EVENT', eventId: eventId, minutes: 30 });
        showToast('💤 Snoozed!', 'Reminder in 30 minutes.');
        break;

      case 'ignore':
        console.log(`[Argus] 📡 Sending IGNORE for event #${eventId}`);
        chrome.runtime.sendMessage({ type: 'IGNORE_EVENT', eventId: eventId });
        showToast('🚫 Ignored', 'Event will not remind you.');
        break;

      case 'acknowledge':
        console.log(`[Argus] 📡 Sending ACKNOWLEDGE_REMINDER for event #${eventId}`);
        chrome.runtime.sendMessage({ type: 'ACKNOWLEDGE_REMINDER', eventId: eventId });
        break;

      case 'done':
      case 'complete':
        console.log(`[Argus] 📡 Sending COMPLETE for event #${eventId}`);
        chrome.runtime.sendMessage({ type: 'COMPLETE_EVENT', eventId: eventId });
        showToast('✅ Completed!', event.title);
        break;

      case 'dismiss':
      case 'dismiss-temp':
        console.log(`[Argus] 🔔 Temporary dismiss for event #${eventId}`);
        if (eventId) dismissedEventIds.add(eventId);
        chrome.runtime.sendMessage({
          type: 'DISMISS_EVENT',
          eventId: eventId,
          permanent: false,
          url: extraData.url || window.location.href
        });
        break;

      case 'dismiss-permanent':
        console.log(`[Argus] ❌ Permanent dismiss for event #${eventId}`);
        if (eventId) dismissedEventIds.add(eventId);
        chrome.runtime.sendMessage({
          type: 'DISMISS_EVENT',
          eventId: eventId,
          permanent: true,
          url: extraData.url || window.location.href
        });
        showToast('Got it!', "Won't show this reminder again.");
        break;

      case 'delete':
        console.log(`[Argus] 🗑️ Deleting event #${eventId}`);
        chrome.runtime.sendMessage({ type: 'DELETE_EVENT', eventId: eventId });
        showToast('🗑️ Event Deleted', event.title);
        break;

      case 'view':
        console.log(`[Argus] 👁️ Opening dashboard`);
        chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
        break;

      case 'view-day':
        console.log(`[Argus] 📅 View My Day for event #${eventId}`);
        // Get event timestamp for the day
        var dayTimestamp = event.event_time || Math.floor(Date.now() / 1000);
        chrome.runtime.sendMessage(
          { type: 'GET_DAY_EVENTS', timestamp: dayTimestamp },
          function(response) {
            if (response && response.events) {
              showDayScheduleInline(response.date, response.events, event);
            } else {
              showToast('📅 No events found', 'Your day looks clear!');
            }
          }
        );
        // Don't close modal — we'll update it inline
        return;
    }

    closeModal();
  }

  // ============ DAY SCHEDULE VIEW ============
  function showDayScheduleInline(dateLabel, events, currentEvent) {
    var modal = document.querySelector('#argus-modal');
    if (!modal) return;

    // Find or create the day-schedule container inside the modal body
    var existing = modal.querySelector('.argus-day-schedule');
    if (existing) existing.remove();

    var container = document.createElement('div');
    container.className = 'argus-day-schedule';
    container.style.cssText = 'margin: 12px 20px; padding: 14px 16px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;';

    var header = '<div style="font-weight: 600; font-size: 13px; color: #0369a1; margin-bottom: 10px;">📅 Your day: ' + escapeHtml(dateLabel || 'Today') + '</div>';

    var timeline = '';
    if (events.length === 0) {
      timeline = '<div style="color: #64748b; font-size: 12px; padding: 8px 0;">Nothing scheduled — your day is wide open! 🎉</div>';
    } else {
      events.forEach(function(ev) {
        var time = '';
        if (ev.event_time) {
          var d = new Date(ev.event_time * 1000);
          time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        }
        var isCurrent = currentEvent && ev.id === currentEvent.id;
        var isConflict = currentEvent && currentEvent.event_time && ev.event_time &&
          Math.abs(ev.event_time - currentEvent.event_time) < 3600 && ev.id !== currentEvent.id;
        
        var dotColor = isConflict ? '#ef4444' : (isCurrent ? '#3b82f6' : '#10b981');
        var bg = isConflict ? 'background: #fef2f2;' : (isCurrent ? 'background: #eff6ff;' : '');
        var label = isConflict ? ' <span style="color: #ef4444; font-size: 10px;">⚠️ overlaps</span>' : '';
        if (isCurrent) label = ' <span style="color: #3b82f6; font-size: 10px;">← new</span>';

        timeline += '<div style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; margin-bottom: 4px; ' + bg + '">';
        timeline += '<div style="width: 8px; height: 8px; border-radius: 50%; background: ' + dotColor + '; flex-shrink: 0;"></div>';
        timeline += '<span style="font-size: 11px; color: #64748b; min-width: 55px;">' + (time || 'All day') + '</span>';
        timeline += '<span style="font-size: 12px; color: #1e293b; font-weight: 500;">' + escapeHtml(ev.title) + '</span>';
        timeline += label;
        timeline += '</div>';
      });
    }

    container.innerHTML = header + timeline;

    // Insert before the actions div
    var actionsDiv = modal.querySelector('.argus-actions');
    if (actionsDiv) {
      actionsDiv.parentNode.insertBefore(container, actionsDiv);
    } else {
      var body = modal.querySelector('.argus-body');
      if (body) body.appendChild(container);
    }
  }

  // ============ TOAST FUNCTIONS ============
  function showToast(title, description) {
    injectStyles();
    const container = createToastContainer();

    const toast = document.createElement('div');
    toast.className = 'argus-toast';
    toast.innerHTML = 
      '<div class="argus-toast-icon">✓</div>' +
      '<div class="argus-toast-content">' +
        '<div class="argus-toast-title">' + escapeHtml(title) + '</div>' +
        '<div class="argus-toast-desc">' + escapeHtml(description) + '</div>' +
      '</div>' +
      '<button class="argus-toast-close">✕</button>';

    toast.querySelector('.argus-toast-close').addEventListener('click', function() {
      removeToast(toast);
    });

    container.appendChild(toast);

    // Auto-remove after 4 seconds
    setTimeout(function() {
      removeToast(toast);
    }, 4000);
  }

  function removeToast(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.add('hiding');
    setTimeout(function() {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 200);
  }

  // ============ UTILITIES ============
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============ MESSAGE HANDLERS ============
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    console.log(`[Argus] 📬 Content script received: ${message.type}`);

    switch (message.type) {
      case 'ARGUS_NEW_EVENT':
        console.log(`[Argus] 📅 New event discovered: "${message.event?.title}" (id: ${message.event?.id})`);
        showModal(message.event, 'event_discovery', { popup: message.popup });
        sendResponse({ received: true });
        break;

      case 'ARGUS_REMINDER':
        console.log(`[Argus] ⏰ Time-based reminder: "${message.event?.title || message.message}" (id: ${message.event?.id})`);
        showModal(message.event || { title: message.message }, 'event_reminder', { popup: message.popup });
        sendResponse({ received: true });
        break;

      case 'ARGUS_CONTEXT_REMINDER':
        console.log(`[Argus] 🌐 Context reminder: "${message.event?.title}" (id: ${message.event?.id}) for URL: ${message.url}`);
        showModal(message.event, 'context_reminder', { url: message.url, popup: message.popup });
        sendResponse({ received: true });
        break;

      case 'ARGUS_CONFLICT':
        console.log(`[Argus] ⚠️ Conflict warning: "${message.event?.title}" conflicts with ${message.conflictingEvents?.length} event(s)`);
        showModal(message.event, 'conflict_warning', { conflictingEvents: message.conflictingEvents, popup: message.popup });
        sendResponse({ received: true });
        break;

      case 'ARGUS_INSIGHT':
        console.log(`[Argus] 💡 Insight card: "${message.event?.title}"`);
        showModal(message.event, 'insight_card', { popup: message.popup });
        sendResponse({ received: true });
        break;

      case 'ARGUS_ACTION_TOAST':
        console.log(`[Argus] 🎯 Action toast: "${message.action}" on "${message.eventTitle}"`);
        const actionEmoji = message.action === 'cancel' || message.action === 'delete' ? '🗑️' :
                           message.action === 'complete' ? '✅' :
                           message.action === 'ignore' ? '🚫' :
                           message.action === 'snooze' || message.action === 'postpone' ? '💤' :
                           message.action === 'modify' ? '📅' : '✓';
        showToast(actionEmoji + ' ' + message.action.charAt(0).toUpperCase() + message.action.slice(1), message.message || message.eventTitle);
        sendResponse({ received: true });
        break;

      default:
        console.log(`[Argus] ❓ Unknown message type: ${message.type}`);
        sendResponse({ received: false, error: 'Unknown message type' });
    }

    return true;
  });

  console.log('[Argus] Content Script v2.6.1 loaded — API-driven popups with CRUD');
})();
