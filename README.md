# Azure DevOps JIRA Status Extension (Firefox)

A Mozilla Firefox browser extension that displays JIRA ticket status next to Azure DevOps build artifacts.

## How to install

1. Open **Firefox** and go to **`about:debugging`** in the address bar.
2. Click **"This Firefox"** in the left sidebar.
3. Click **"Load Temporary Add-on..."**.
4. Select **`manifest.json`** from this folder.

The extension stays loaded until you close Firefox or remove it under `about:debugging`.  
For a permanent install, package the folder as a `.xpi` and use **about:addons** → gear → **"Install Add-on From File..."**.

## Features

- Automatically detects JIRA ticket numbers (ECP-XXXX format) in Azure DevOps build artifacts
- Fetches ticket status from JIRA API via background script (bypasses CORS)
- Displays colored status badges next to each artifact
- Clickable badges that open the JIRA ticket in a new tab
- Caches status information for 5 minutes to reduce API calls
- Works with dynamically loaded content (SPA support)

## Installation

### Temporary Installation (for Development)

1. Open Firefox
2. Navigate to `about:debugging`
3. Click "This Firefox" in the left sidebar
4. Click "Load Temporary Add-on..."
5. Select the `manifest.json` file from this folder

### Permanent Installation (for Production)

1. Package the extension as a `.xpi` file
2. Open Firefox
3. Navigate to `about:addons`
4. Click the gear icon and select "Install Add-on From File..."
5. Select the `.xpi` file

## Usage

1. Navigate to an Azure DevOps build page:
   - Example: `https://commify.visualstudio.com/Titan%20Single%20Customer%20Portal/_build?definitionId=824`
2. The extension will automatically:
   - Scan for JIRA tickets (ECP-XXXX format) in artifact names
   - Fetch their status from JIRA via background script
   - Display status badges next to each artifact

## Status Colors

- **Blue** (#0052CC): New/To Do
- **Yellow/Orange** (#FFAB00): In Progress
- **Green** (#00875A): Done
- **Gray** (#6B778C): Unknown/Error

## Configuration

The extension is configured for:
- **Azure DevOps**: `https://commify.visualstudio.com`
- **JIRA**: `https://esendex.atlassian.net`
- **Ticket Pattern**: `ECP-\d+` (e.g., ECP-4849, ECP-4749)

To modify these settings, edit `content.js`:
- `JIRA_BASE_URL`: Change the JIRA instance URL
- `JIRA_TICKET_PATTERN`: Modify the regex pattern for ticket detection

## Requirements

- Mozilla Firefox 91 or above
- Access to both Azure DevOps and JIRA instances
- Valid authentication cookies for JIRA (the extension uses your existing session)

## Files

- `manifest.json`: Extension manifest file (Firefox Manifest V2)
- `content.js`: Main content script that processes the page
- `background.js`: Background script that handles JIRA API calls (bypasses CORS)

## Differences from Edge/Chrome Version

- Uses Manifest V2 (Firefox format)
- Uses background script instead of service worker
- Uses `browser` API (with `chrome` API fallback for compatibility)
- Background script is non-persistent (more efficient)

## Notes

- The extension requires authentication cookies to access JIRA API. Make sure you're logged into JIRA in the same browser.
- Status information is cached for 5 minutes to reduce API load.
- The extension works with Azure DevOps pages that use dynamic content loading.
- Background script bypasses CORS restrictions that would block content scripts.
