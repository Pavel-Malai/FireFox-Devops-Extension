// Background service worker for Azure DevOps JIRA Status Extension

const JIRA_BASE_URL = 'https://esendex.atlassian.net';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Cache for JIRA ticket statuses
const statusCache = new Map();

// Get color based on status category and status name
function getStatusColor(category, statusName) {
  // Check for specific status names first
  const statusLower = statusName?.toLowerCase() || '';
  if (statusLower.includes('awaiting release')) {
    return '#9B59B6'; // Purple for awaiting release
  }
  
  // Then check category
  const colors = {
    'new': '#0052CC',      // Blue
    'indeterminate': '#FFAB00', // Yellow/Orange
    'done': '#00875A',     // Green
    'default': '#6B778C'   // Gray
  };
  return colors[category?.toLowerCase()] || colors.default;
}

// Fetch JIRA ticket status
async function fetchJiraStatus(ticketId) {
  // Check cache first
  const cached = statusCache.get(ticketId);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.status;
  }

  try {
    const url = `${JIRA_BASE_URL}/rest/api/3/issue/${ticketId}?fields=status`;
    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const status = data.fields?.status?.name || 'Unknown';
    const statusColor = getStatusColor(data.fields?.status?.statusCategory?.name, status);

    const result = {
      name: status,
      color: statusColor,
      category: data.fields?.status?.statusCategory?.name
    };

    // Cache the result
    statusCache.set(ticketId, {
      status: result,
      timestamp: Date.now()
    });

    return result;
  } catch (error) {
    console.error(`[Background] Error fetching JIRA status for ${ticketId}:`, error);
    return {
      name: 'Error',
      color: '#6B778C',
      category: 'unknown',
      error: error.message
    };
  }
}

// Use browser API (Firefox) or chrome API (for compatibility)
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// Listen for messages from content script
browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchJiraStatus') {
    const ticketId = request.ticketId;

    fetchJiraStatus(ticketId)
      .then(status => {
        sendResponse({ success: true, status: status });
      })
      .catch(error => {
        sendResponse({
          success: false,
          error: error.message,
          status: {
            name: 'Error',
            color: '#6B778C',
            category: 'unknown'
          }
        });
      });

    // Return true to indicate we will send a response asynchronously
    return true;
  }
});

console.log('[JIRA Status Extension] Background service worker loaded');
