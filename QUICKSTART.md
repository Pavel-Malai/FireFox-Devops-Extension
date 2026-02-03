# Quick Start Guide (Firefox)

## Installation Steps

1. **Prepare the extension folder**
   - All files should be in the same folder
   - Make sure `manifest.json`, `content.js`, and `background.js` are present

2. **Load in Firefox**
   - Open Firefox browser
   - Go to `about:debugging`
   - Click "This Firefox" in the left sidebar
   - Click "Load Temporary Add-on..."
   - Select the `manifest.json` file

3. **Test the extension**
   - Navigate to: `https://commify.visualstudio.com/Titan%20Single%20Customer%20Portal/_build?definitionId=824`
   - Make sure you're logged into JIRA: `https://esendex.atlassian.net`
   - Look for JIRA status badges appearing next to artifacts containing ticket numbers (ECP-XXXX)

## What to Expect

- Status badges will appear next to artifacts/builds that contain JIRA ticket numbers
- Badges are color-coded:
  - **Blue**: New/To Do
  - **Yellow/Orange**: In Progress  
  - **Green**: Done
  - **Gray**: Unknown/Error
- Click a badge to open the JIRA ticket in a new tab
- Status is cached for 5 minutes to reduce API calls

## Example

If you see an artifact like:
```
#20260116.2 • feat: ECP-4849 [BFF] Return isBillable flag field
```

You should see a status badge next to it showing the current JIRA status (e.g., "In Progress", "Done", etc.)

## Troubleshooting

### Extension not loading
- Make sure you're using Firefox 91 or above
- Check `about:debugging` for any error messages
- Verify all files are in the same folder

### Badges not appearing
- Open Developer Tools (F12) and check the Console tab
- Look for `[JIRA Status Extension]` messages
- Verify you're on the correct Azure DevOps page
- Make sure you're logged into JIRA

### CORS errors
- The background script should handle CORS automatically
- If you see CORS errors, check the background script console:
  - Go to `about:debugging`
  - Find your extension
  - Click "Inspect" next to the background script
  - Check for errors there
