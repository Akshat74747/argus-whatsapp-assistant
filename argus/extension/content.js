// Argus Content Script v2.1
// In-page overlay popups for event notifications
// Popup Types: event_discovery, event_reminder, context_reminder, conflict_warning, insight_card

(function() {
  'use strict';

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
  const MODAL_CONFIGS = {
    event_discovery: {
      icon: '📅',
      headerClass: 'discovery',
      title: 'New Event Detected!',
      subtitle: 'From your WhatsApp messages',
      question: 'Would you like to set a reminder for this event?',
      buttons: [
        { text: '⏰ Set Reminder', action: 'set-reminder', style: 'primary' },
        { text: 'Not Now', action: 'dismiss', style: 'secondary' },
        { text: '🗑️ Delete', action: 'delete', style: 'outline' },
      ]
    },
    event_reminder: {
      icon: '⏰',
      headerClass: 'reminder',
      title: 'Event Starting Soon!',
      subtitle: 'This is your scheduled reminder',
      question: null,
      buttons: [
        { text: '✓ Got It', action: 'acknowledge', style: 'primary' },
        { text: '✅ Mark Done', action: 'done', style: 'success' },
      ]
    },
    context_reminder: {
      icon: '🎯',
      headerClass: 'context',
      title: 'Remember This?',
      subtitle: 'You mentioned wanting to do this',
      question: 'Would you like to take action now?',
      buttons: [
        { text: '✅ Done', action: 'done', style: 'success' },
        { text: 'Later', action: 'dismiss-temp', style: 'secondary' },
        { text: "Don't Show Again", action: 'dismiss-permanent', style: 'outline' },
      ]
    },
    conflict_warning: {
      icon: '⚠️',
      headerClass: 'conflict',
      title: 'Schedule Conflict!',
      subtitle: 'You may have overlapping commitments',
      question: null,
      buttons: [
        { text: 'View Details', action: 'view', style: 'primary' },
        { text: 'Ignore', action: 'dismiss', style: 'secondary' },
      ]
    },
    insight_card: {
      icon: '💡',
      headerClass: 'insight',
      title: 'Suggestion',
      subtitle: 'Based on your conversations',
      question: null,
      buttons: [
        { text: 'Thanks!', action: 'acknowledge', style: 'primary' },
        { text: 'Not Relevant', action: 'dismiss', style: 'secondary' },
      ]
    }
  };

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
    // Prevent duplicate modals
    if (event.id && shownEventIds.has(event.id)) {
      console.log('[Argus] Modal already shown for event:', event.id);
      return;
    }

    injectStyles();

    // Close any existing modal
    if (currentModal) {
      currentModal.remove();
      currentModal = null;
    }

    if (event.id) {
      shownEventIds.add(event.id);
    }

    const config = MODAL_CONFIGS[popupType] || MODAL_CONFIGS.event_discovery;

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
      html += '<div class="argus-event-desc">' + escapeHtml(event.description) + '</div>';
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
    console.log('[Argus] Action:', action, 'Event:', eventId);

    switch (action) {
      case 'set-reminder':
        chrome.runtime.sendMessage({ type: 'SET_REMINDER', eventId: eventId });
        showToast('⏰ Reminder Set!', 'You will be notified before the event.');
        break;

      case 'acknowledge':
        chrome.runtime.sendMessage({ type: 'ACKNOWLEDGE_REMINDER', eventId: eventId });
        break;

      case 'done':
        chrome.runtime.sendMessage({ type: 'MARK_DONE', eventId: eventId });
        showToast('✅ Marked as Done!', event.title);
        break;

      case 'dismiss':
      case 'dismiss-temp':
        chrome.runtime.sendMessage({
          type: 'DISMISS_EVENT',
          eventId: eventId,
          permanent: false,
          url: extraData.url || window.location.href
        });
        break;

      case 'dismiss-permanent':
        chrome.runtime.sendMessage({
          type: 'DISMISS_EVENT',
          eventId: eventId,
          permanent: true,
          url: extraData.url || window.location.href
        });
        showToast('Got it!', "Won't show this reminder again.");
        break;

      case 'delete':
        chrome.runtime.sendMessage({ type: 'DELETE_EVENT', eventId: eventId });
        showToast('🗑️ Event Deleted', event.title);
        break;

      case 'view':
        chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
        break;
    }

    closeModal();
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
    console.log('[Argus] Content received:', message.type);

    switch (message.type) {
      case 'ARGUS_NEW_EVENT':
        showModal(message.event, 'event_discovery');
        sendResponse({ received: true });
        break;

      case 'ARGUS_REMINDER':
        showModal(message.event || { title: message.message }, 'event_reminder');
        sendResponse({ received: true });
        break;

      case 'ARGUS_CONTEXT_REMINDER':
        showModal(message.event, 'context_reminder', { url: message.url });
        sendResponse({ received: true });
        break;

      case 'ARGUS_CONFLICT':
        showModal(message.event, 'conflict_warning');
        sendResponse({ received: true });
        break;

      case 'ARGUS_INSIGHT':
        showModal(message.event, 'insight_card');
        sendResponse({ received: true });
        break;

      default:
        sendResponse({ received: false, error: 'Unknown message type' });
    }

    return true;
  });

  console.log('[Argus] Content Script v2.1 loaded');
})();
