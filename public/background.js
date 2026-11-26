// The service worker only opens the side panel. All AI runs in the side panel,
// because Chrome's Prompt API (Gemini Nano) isn't available in workers.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
