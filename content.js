// Content script for Azure DevOps JIRA Status Extension

// Immediately expose test function to window (before IIFE)
window.testJiraExtension = function() {
  console.log('[JIRA Status Extension] Test function called - script is loaded!');
  console.log('[JIRA Status Extension] Current URL:', window.location.href);
  console.log('[JIRA Status Extension] Hostname:', window.location.hostname);
  
  // Check if extension functions are available
  if (typeof window.jiraStatusExtensionLoaded !== 'undefined') {
    console.log('[JIRA Status Extension] Extension fully initialized');
    // Call the actual test if available
    if (window.jiraStatusExtensionLoaded.test) {
      return window.jiraStatusExtensionLoaded.test();
    }
  } else {
    console.log('[JIRA Status Extension] Extension script loaded but not fully initialized yet');
  }
  
  return {
    scriptLoaded: true,
    url: window.location.href,
    hostname: window.location.hostname
  };
};

(function() {
  'use strict';

  const JIRA_BASE_URL = 'https://esendex.atlassian.net';
  // Match ECP-XXXX, ecp-XXXX, IP-XXXX, IP XXXX, ECP XXXX, ecp XXXX (with optional spaces)
  // Pattern: prefix, then (dash with optional spaces OR space), then digits
  const JIRA_TICKET_PATTERN = /(?:ECP|ecp|IP)(?:\s*-\s*|\s+)\d+/gi;
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  // Cache for JIRA ticket statuses (client-side cache)
  const statusCache = new Map();

  // Use browser API (Firefox) or chrome API (Chrome/Edge compatibility)
  const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

  // Normalize JIRA ticket ID to standard format (e.g., ECP-4805, IP-4805)
  function normalizeTicketId(ticketId) {
    if (!ticketId) return null;
    
    // Remove extra spaces and normalize to uppercase prefix with dash
    const normalized = ticketId.trim()
      .replace(/\s+/g, '-')  // Replace spaces with dashes
      .replace(/-+/g, '-');  // Replace multiple dashes with single dash
    
    // Ensure uppercase prefix
    if (normalized.match(/^(ECP|ecp|IP|ip)-/i)) {
      const parts = normalized.split('-');
      if (parts.length >= 2) {
        return `${parts[0].toUpperCase()}-${parts.slice(1).join('-')}`;
      }
    }
    
    return normalized.toUpperCase();
  }

  // Extract JIRA ticket from text
  // Returns the first match, or the most relevant one if multiple exist
  function extractJiraTicket(text) {
    const matches = text.match(JIRA_TICKET_PATTERN);
    if (!matches || matches.length === 0) return null;
    
    // If multiple tickets, prefer the one that appears in a commit/feat context
    // Pattern like "feat: ECP-XXXX" or "#XXXX • feat: ECP-XXXX"
    for (const match of matches) {
      const index = text.indexOf(match);
      const context = text.substring(Math.max(0, index - 20), index + match.length + 20).toLowerCase();
      if (context.includes('feat:') || context.includes('fix:') || context.includes('•')) {
        return normalizeTicketId(match);
      }
    }
    
    // Otherwise return the first match, normalized
    return normalizeTicketId(matches[0]);
  }

  // Fetch JIRA ticket status via background script (bypasses CORS)
  async function fetchJiraStatus(ticketId) {
    // Check cache first
    const cached = statusCache.get(ticketId);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.status;
    }

    try {
      // Send message to background script
      const response = await browserAPI.runtime.sendMessage({
        action: 'fetchJiraStatus',
        ticketId: ticketId
      });

      if (response && response.success) {
        const result = response.status;
        
        // Cache the result
        statusCache.set(ticketId, {
          status: result,
          timestamp: Date.now()
        });

        return result;
      } else {
        throw new Error(response?.error || 'Unknown error');
      }
    } catch (error) {
      console.error(`Error fetching JIRA status for ${ticketId}:`, error);
      return {
        name: 'Error',
        color: '#6B778C',
        category: 'unknown'
      };
    }
  }

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

  // Create status badge element
  function createStatusBadge(ticketId, status) {
    const badge = document.createElement('span');
    badge.className = 'jira-status-badge';
    badge.style.cssText = `
      display: inline-block;
      margin-left: 8px;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 500;
      color: white;
      background-color: ${status.color};
      cursor: pointer;
      text-decoration: none;
      vertical-align: middle;
    `;
    badge.textContent = status.name;
    badge.title = `JIRA ${ticketId}: ${status.name}`;
    
    // Make it clickable to open JIRA ticket
    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(`${JIRA_BASE_URL}/browse/${ticketId}`, '_blank');
    });

    return badge;
  }

  // Check if element should be excluded (too high in DOM hierarchy)
  function shouldExcludeElement(element) {
    // Exclude root and structural elements
    const excludedTags = ['HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'TITLE'];
    if (excludedTags.includes(element.tagName)) return true;
    
    // Exclude if element contains too much content (likely a container)
    // But be more lenient - only exclude very large containers
    const textLength = (element.textContent || '').length;
    if (textLength > 5000) return true; // Only exclude very large containers
    
    // Exclude if element is a direct child of body or html (but allow deeper nesting)
    if (element.parentElement === document.body || element.parentElement === document.documentElement) {
      return true;
    }
    
    return false;
  }

  // Global set to track tickets that already have badges in the DOM
  const ticketsWithBadges = new Set();

  // Check if a badge for this ticket already exists anywhere in the DOM
  // Also checks if the badge is in a valid location (not orphaned)
  function hasBadgeForTicket(ticketId) {
    // Always check the DOM first (more reliable for virtual scrolling)
    const existingBadge = document.querySelector(`.jira-status-badge[title*="${ticketId}"]`);
    if (existingBadge) {
      // Verify the badge is in a valid location - check if parent contains the ticket text
      let parent = existingBadge.parentElement;
      let isValid = false;
      let checks = 0;
      while (parent && checks < 5) { // Check up to 5 levels up
        const parentText = parent.textContent || '';
        if (extractJiraTicket(parentText) === ticketId) {
          isValid = true;
          break;
        }
        parent = parent.parentElement;
        checks++;
      }
      
      // If badge exists but is orphaned (not near the ticket text), remove it
      if (!isValid) {
        console.log(`[JIRA Status] Removing orphaned badge for ${ticketId}`);
        existingBadge.remove();
        if (ticketsWithBadges.has(ticketId)) {
          ticketsWithBadges.delete(ticketId);
        }
        return false;
      }
      
      // Update tracking set if badge exists and is valid
      if (!ticketsWithBadges.has(ticketId)) {
        ticketsWithBadges.add(ticketId);
      }
      return true;
    }
    
    // If badge doesn't exist in DOM, remove from tracking set (cleanup)
    if (ticketsWithBadges.has(ticketId)) {
      ticketsWithBadges.delete(ticketId);
    }
    
    return false;
  }

  // Find the best element to attach badge to (prefer leaf nodes with artifact pattern)
  function findElementsWithJiraTickets() {
    const allElements = document.querySelectorAll('*');
    const candidates = [];
    const processedTickets = new Set(); // Track tickets we've already found a candidate for

    for (const element of allElements) {
      // Skip excluded elements
      if (shouldExcludeElement(element)) continue;
      
      const text = element.textContent || '';
      const ticketId = extractJiraTicket(text);
      
      if (!ticketId) continue;
      
      // Skip if we already have a better candidate for this ticket
      if (processedTickets.has(ticketId)) continue;
      
      // Skip if a badge for this ticket already exists anywhere in the DOM
      if (hasBadgeForTicket(ticketId)) continue;
      
      // Look for patterns like "#20260116.2 • feat: ECP-4849" or "#20260113.3 • Pavel.malai/IP-4805"
      const hasArtifactPattern = /#\d+\.\d+\s*[•·]\s*.*(?:ECP|ecp|IP)(?:\s*-\s*|\s+)\d+/i.test(text);
      
      // Check if in build/pipeline context
      const buildContext = element.closest('[class*="build"]') || 
                          element.closest('[class*="artifact"]') ||
                          element.closest('[class*="pipeline"]') ||
                          element.closest('[class*="run"]') ||
                          element.closest('table') ||
                          element.closest('[data-testid*="build"]') ||
                          element.closest('[data-testid*="run"]') ||
                          window.location.pathname.includes('_build');
      
      // Prefer links and spans that contain the artifact pattern (most specific)
      const isLinkOrSpan = (element.tagName === 'A' || element.tagName === 'SPAN') && 
                           text.length < 500 &&
                           text.length > 5;
      
      // Table rows are also good candidates
      const isTableRow = element.tagName === 'TR';
      
      // Table cells can work too
      const isTableCell = (element.tagName === 'TD' || element.tagName === 'TH') && 
                         text.length < 500;
      
      // Prioritize elements with artifact pattern and links/spans
      if (hasArtifactPattern && isLinkOrSpan) {
        // Best candidate - artifact pattern in a link/span
        candidates.push({
          element: element,
          ticketId: ticketId,
          text: text,
          priority: 1
        });
        processedTickets.add(ticketId);
      } else if (hasArtifactPattern && (isTableRow || isTableCell)) {
        // Good candidate - artifact pattern in table
        candidates.push({
          element: element,
          ticketId: ticketId,
          text: text,
          priority: 2
        });
        processedTickets.add(ticketId);
      } else if (hasArtifactPattern && text.length < 500 && element.children.length <= 15) {
        // Artifact pattern in other elements (div, etc.) - still important
        candidates.push({
          element: element,
          ticketId: ticketId,
          text: text,
          priority: 2.5
        });
        processedTickets.add(ticketId);
      } else if (isLinkOrSpan && buildContext && text.length < 300) {
        // Link/span in build context
        candidates.push({
          element: element,
          ticketId: ticketId,
          text: text,
          priority: 3
        });
        processedTickets.add(ticketId);
      } else if (isTableRow && buildContext) {
        // Table row in build context
        candidates.push({
          element: element,
          ticketId: ticketId,
          text: text,
          priority: 4
        });
        processedTickets.add(ticketId);
      }
    }

    // If no candidates found, try a more lenient approach
    // Also check for elements with artifact pattern that didn't match strict criteria
    if (candidates.length === 0) {
      console.log('[JIRA Status] No candidates found with strict filtering, trying lenient approach');
      
      for (const element of document.querySelectorAll('*')) {
        if (shouldExcludeElement(element)) continue;
        
        const text = element.textContent || '';
        const ticketId = extractJiraTicket(text);
        
        if (!ticketId || processedTickets.has(ticketId)) continue;
        if (hasBadgeForTicket(ticketId)) continue;
        
        // Check for artifact pattern
        const hasArtifactPattern = /#\d+\.\d+\s*[•·]\s*.*(?:ECP|ecp|IP)(?:\s*-\s*|\s+)\d+/i.test(text);
        
        if (text.length < 1000 && text.length > 5) {
          const childCount = element.children.length;
          // Prioritize elements with artifact pattern
          if (hasArtifactPattern && childCount <= 15) {
            candidates.push({
              element: element,
              ticketId: ticketId,
              text: text.substring(0, 100),
              priority: 4  // Higher priority for artifact pattern
            });
            processedTickets.add(ticketId);
          } else if (childCount <= 10) {
            candidates.push({
              element: element,
              ticketId: ticketId,
              text: text.substring(0, 100),
              priority: 5
            });
            processedTickets.add(ticketId);
          }
        }
      }
    }
    
    // Sort by priority (lower number = higher priority)
    candidates.sort((a, b) => a.priority - b.priority);
    
    return candidates;
  }

  // Process artifact elements
  async function processArtifacts() {
    const candidates = findElementsWithJiraTickets();
    const ticketStatusPromises = new Map(); // Track ongoing requests per ticket

    // Debug logging
    if (candidates.length > 0) {
      console.log(`[JIRA Status] Found ${candidates.length} candidates with JIRA tickets`);
    }

    for (const candidate of candidates) {
      // Double-check: skip if a badge for this ticket already exists anywhere
      if (hasBadgeForTicket(candidate.ticketId)) {
        // Debug: log when we skip a ticket
        if (candidate.ticketId.includes('ECP-4805') || candidate.ticketId.includes('IP-4805')) {
          console.log(`[JIRA Status] Skipping ${candidate.ticketId} - badge already exists`);
        }
        continue;
      }
      
      // Debug: log when processing specific tickets
      if (candidate.ticketId.includes('ECP-4805') || candidate.ticketId.includes('IP-4805')) {
        console.log(`[JIRA Status] Processing ${candidate.ticketId}`, candidate.element, candidate.text.substring(0, 50));
      }

      try {
        // Check if we're already fetching status for this ticket (to avoid duplicate requests)
        let statusPromise = ticketStatusPromises.get(candidate.ticketId);
        if (!statusPromise) {
          statusPromise = fetchJiraStatus(candidate.ticketId);
          ticketStatusPromises.set(candidate.ticketId, statusPromise);
        }
        
        const status = await statusPromise;
        
        // Final check before creating badge - make sure no badge was added while we were fetching
        if (hasBadgeForTicket(candidate.ticketId)) {
          continue;
        }
        
        const badge = createStatusBadge(candidate.ticketId, status);
        
        const element = candidate.element;
        let inserted = false;
        
        // For links and spans (artifact names), append badge to parent (bottom of artifact)
        if (element.tagName === 'A' || element.tagName === 'SPAN') {
          if (element.parentNode) {
            // Append to parent to place at bottom
            element.parentNode.appendChild(badge);
            inserted = true;
          }
        }
        
        // For table rows, find the cell containing the artifact name or use the last cell
        if (!inserted && element.tagName === 'TR') {
          // Try to find the cell that contains the artifact name (link/span with ticket)
          const artifactCell = Array.from(element.querySelectorAll('td, th')).find(cell => {
            const cellText = cell.textContent || '';
            return extractJiraTicket(cellText) === candidate.ticketId;
          });
          
          if (artifactCell) {
            // Check if this cell already has a badge for this ticket
            if (!artifactCell.querySelector(`.jira-status-badge[title*="${candidate.ticketId}"]`)) {
              artifactCell.appendChild(badge);
              inserted = true;
            }
          } else {
            // Fallback: use last cell
            let lastCell = element.querySelector('td:last-child, th:last-child');
            if (lastCell && !lastCell.querySelector(`.jira-status-badge[title*="${candidate.ticketId}"]`)) {
              lastCell.appendChild(badge);
              inserted = true;
            }
          }
        }
        
        // For table cells, append to the cell
        if (!inserted && (element.tagName === 'TD' || element.tagName === 'TH')) {
          if (!element.querySelector(`.jira-status-badge[title*="${candidate.ticketId}"]`)) {
            element.appendChild(badge);
            inserted = true;
          }
        }
        
        // For elements with artifact pattern (divs, etc.), try to find a better insertion point
        if (!inserted && element !== document.body && element !== document.documentElement) {
          // Check if element already has a badge
          if (element.querySelector(`.jira-status-badge[title*="${candidate.ticketId}"]`)) {
            inserted = true; // Badge already exists
          } else {
            // Try to find a link or span child that contains the ticket
            const childWithTicket = Array.from(element.querySelectorAll('a, span')).find(child => {
              const childText = child.textContent || '';
              return extractJiraTicket(childText) === candidate.ticketId;
            });
            
            if (childWithTicket && childWithTicket.parentNode) {
              // Append to parent to place at bottom
              childWithTicket.parentNode.appendChild(badge);
              inserted = true;
            } else {
              // Fallback: append to element (bottom)
              element.appendChild(badge);
              inserted = true;
            }
          }
        }
        
        // Mark this ticket as having a badge if we successfully inserted one
        if (inserted) {
          ticketsWithBadges.add(candidate.ticketId);
        }
      } catch (error) {
        console.error(`Error processing artifact for ${candidate.ticketId}:`, error);
      }
    }
    
    // Clear the promises map after processing
    ticketStatusPromises.clear();
  }

  // Track if initial processing is complete
  let initialProcessingComplete = false;

  // Re-attach badges for elements that were re-rendered (virtual scrolling)
  // Uses cached statuses without re-fetching
  function reattachBadges() {
    // Only check elements that are likely to contain tickets (more efficient)
    // Focus on links, spans, table rows, and table cells
    const candidateSelectors = 'a, span, tr, td, th, [class*="artifact"], [class*="build"], [class*="run"]';
    const candidateElements = document.querySelectorAll(candidateSelectors);
    let reattachedCount = 0;
    const processedTickets = new Set(); // Avoid processing same ticket multiple times

    for (const element of candidateElements) {
      if (shouldExcludeElement(element)) continue;
      
      const text = element.textContent || '';
      const ticketId = extractJiraTicket(text);
      
      if (!ticketId || processedTickets.has(ticketId)) continue;
      
      // Check if this element should have a badge but doesn't
      const existingBadge = element.querySelector(`.jira-status-badge[title*="${ticketId}"]`) ||
                            element.parentElement?.querySelector(`.jira-status-badge[title*="${ticketId}"]`);
      
      if (!existingBadge) {
        // Check if we have cached status for this ticket
        const cached = statusCache.get(ticketId);
        if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
          // Re-attach badge using cached status
          const badge = createStatusBadge(ticketId, cached.status);
          
          // Try to insert badge in the same way as initial processing
          let inserted = false;
          
          if (element.tagName === 'A' || element.tagName === 'SPAN') {
            if (element.parentNode) {
              // Append to parent to place at bottom
              element.parentNode.appendChild(badge);
              inserted = true;
            }
          } else if (element.tagName === 'TR') {
            const artifactCell = Array.from(element.querySelectorAll('td, th')).find(cell => {
              const cellText = cell.textContent || '';
              return extractJiraTicket(cellText) === ticketId;
            });
            if (artifactCell && !artifactCell.querySelector(`.jira-status-badge[title*="${ticketId}"]`)) {
              artifactCell.appendChild(badge);
              inserted = true;
            }
          } else if (element.tagName === 'TD' || element.tagName === 'TH') {
            if (!element.querySelector(`.jira-status-badge[title*="${ticketId}"]`)) {
              element.appendChild(badge);
              inserted = true;
            }
          } else {
            // For other elements, try to find a child link/span
            const childWithTicket = Array.from(element.querySelectorAll('a, span')).find(child => {
              const childText = child.textContent || '';
              return extractJiraTicket(childText) === ticketId;
            });
            if (childWithTicket && childWithTicket.parentNode) {
              if (!childWithTicket.parentNode.querySelector(`.jira-status-badge[title*="${ticketId}"]`)) {
                // Append to parent to place at bottom
                childWithTicket.parentNode.appendChild(badge);
                inserted = true;
              }
            } else if (!element.querySelector(`.jira-status-badge[title*="${ticketId}"]`)) {
              // Append to element (bottom)
              element.appendChild(badge);
              inserted = true;
            }
          }
          
          if (inserted) {
            ticketsWithBadges.add(ticketId);
            processedTickets.add(ticketId);
            reattachedCount++;
          }
        }
      } else {
        // Badge exists, mark ticket as processed
        processedTickets.add(ticketId);
      }
    }
    
    if (reattachedCount > 0) {
      console.log(`[JIRA Status] Re-attached ${reattachedCount} badges from cache`);
    }
  }

  // Use MutationObserver to watch for content changes
  function observeChanges() {
    const observer = new MutationObserver((mutations) => {
      let hasNewContent = false;
      
      // Check if initial processing is needed
      if (!initialProcessingComplete) {
        for (const mutation of mutations) {
          if (mutation.addedNodes.length > 0) {
            hasNewContent = true;
            break;
          }
        }
        
        if (hasNewContent) {
          // Debounce processing
          clearTimeout(window.jiraStatusProcessTimeout);
          window.jiraStatusProcessTimeout = setTimeout(() => {
            processArtifacts();
            // Mark initial processing as complete after first run
            initialProcessingComplete = true;
          }, 500);
        }
        return;
      }
      
      // After initial processing, process new artifacts and re-attach badges when content is added
      // This handles virtual scrolling - new artifacts get processed, existing ones get badges re-attached
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          hasNewContent = true;
          break;
        }
      }
      
      if (hasNewContent) {
        // Process new artifacts and re-attach badges
        // Use a short delay to allow DOM to settle
        clearTimeout(window.jiraStatusReattachTimeout);
        window.jiraStatusReattachTimeout = setTimeout(() => {
          // First, re-attach badges for artifacts we've already processed (from cache)
          reattachBadges();
          // Then, process any new artifacts that don't have cached statuses yet
          processArtifacts();
        }, 100);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Check if URL has definitionId parameter
  function hasDefinitionId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.has('definitionId');
  }

  // Initialize
  function init() {
    // Check if we're on the right page with definitionId parameter
    if (window.location.hostname === 'commify.visualstudio.com' && 
        (window.location.pathname.includes('_build') || window.location.pathname.includes('_pipeline')) &&
        hasDefinitionId()) {
      
      console.log('[JIRA Status Extension] Initializing on Azure DevOps page with definitionId');
      
      // Process existing content once on page load
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          console.log('[JIRA Status Extension] DOM loaded, processing artifacts once...');
          setTimeout(() => {
            processArtifacts();
            initialProcessingComplete = true;
          }, 1000);
          // Only observe for initial content loading
          observeChanges();
        });
      } else {
        console.log('[JIRA Status Extension] DOM already loaded, processing artifacts once...');
        setTimeout(() => {
          processArtifacts();
          initialProcessingComplete = true;
        }, 1000);
        // Only observe for initial content loading
        observeChanges();
      }
    } else {
      if (window.location.hostname === 'commify.visualstudio.com' && 
          (window.location.pathname.includes('_build') || window.location.pathname.includes('_pipeline'))) {
        console.log('[JIRA Status Extension] On Azure DevOps page but no definitionId parameter, skipping');
      } else {
        console.log('[JIRA Status Extension] Not on Azure DevOps build page, skipping');
      }
    }
  }

  // Start initialization
  init();

  // Visibility change handling removed - statuses are only fetched once on page load

  // Handle scroll events to re-attach badges (using cached statuses, no re-fetching)
  // Note: The MutationObserver should handle most cases, but this is a backup
  let scrollTimeout;
  window.addEventListener('scroll', () => {
    if (!hasDefinitionId() || !initialProcessingComplete) return;
    
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      // Re-attach badges that were removed by virtual scrolling
      // Uses cached statuses only, doesn't re-fetch
      // This is a backup - MutationObserver should catch most cases immediately
      reattachBadges();
    }, 200);
  }, { passive: true });

  // Watch for URL changes (for SPAs that change URL without reload)
  // Only re-process if it's a completely new page (different definitionId)
  let lastUrl = window.location.href;
  let lastDefinitionId = null;
  setInterval(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      // Only re-process if definitionId changed (new page)
      const urlParams = new URLSearchParams(window.location.search);
      const currentDefinitionId = urlParams.get('definitionId');
      if (hasDefinitionId() && window.location.pathname.includes('_build') && 
          currentDefinitionId !== lastDefinitionId) {
        console.log('[JIRA Status Extension] New page detected, processing artifacts once...');
        lastDefinitionId = currentDefinitionId;
        initialProcessingComplete = false; // Reset flag for new page
        setTimeout(() => {
          processArtifacts();
          initialProcessingComplete = true;
        }, 1000);
      }
    }
  }, 1000);

  // Expose extension API to window
  window.jiraStatusExtensionLoaded = {
    test: function() {
      console.log('[JIRA Status Extension] Full test function called');
      console.log('[JIRA Status Extension] Current URL:', window.location.href);
      console.log('[JIRA Status Extension] Hostname:', window.location.hostname);
      console.log('[JIRA Status Extension] Pathname:', window.location.pathname);
      
      // Test ticket extraction with various formats
      const testTexts = [
        '#20260116.2 • feat: ECP-4849 [BFF] Return isBillable flag field',
        '#20260113.3 • Pavel.malai/ecp 4805 (#637)',
        '#20260113.3 • Pavel.malai/IP 4805 (#637)',
        '#20260113.3 • Pavel.malai/IP-4805 (#637)'
      ];
      testTexts.forEach(testText => {
        const testTicket = extractJiraTicket(testText);
        console.log('[JIRA Status Extension] Test extraction:', testText, '->', testTicket);
      });
      
      // Count elements with JIRA tickets (all formats)
      const allText = document.body ? document.body.textContent || '' : '';
      const ticketMatches = allText.match(JIRA_TICKET_PATTERN);
      console.log('[JIRA Status Extension] Found JIRA tickets in page:', ticketMatches ? ticketMatches.length : 0, ticketMatches);
      
      // Run processing
      processArtifacts();
      
      return {
        url: window.location.href,
        ticketCount: ticketMatches ? ticketMatches.length : 0,
        tickets: ticketMatches ? [...new Set(ticketMatches)] : [],
        extensionLoaded: true
      };
    },
    processArtifacts: processArtifacts,
    extractJiraTicket: extractJiraTicket
  };

  // Update the test function to use the full version
  window.testJiraExtension = function() {
    if (window.jiraStatusExtensionLoaded && window.jiraStatusExtensionLoaded.test) {
      return window.jiraStatusExtensionLoaded.test();
    } else {
      console.log('[JIRA Status Extension] Extension not fully loaded yet');
      return { error: 'Extension not fully initialized' };
    }
  };

  // Log that extension loaded
  console.log('[JIRA Status Extension] Content script loaded and initialized');
  console.log('[JIRA Status Extension] Test function available: testJiraExtension()');

})();
