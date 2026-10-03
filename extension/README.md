# AccessApply Chrome extension

Build the extension package from the repository root with:

```powershell
cd extension
npm run build
```

The build runs the frontend checks and copies both applications, the shared profile storage module, and the extension launcher into `extension/dist`. In Chrome, open `chrome://extensions`, enable Developer mode, and choose **Load unpacked** with the `extension/dist` folder.

The extension action opens a small loading page first. It checks `chrome.storage.local` through the shared profile service and redirects to onboarding when no completed profile exists, or to the accessibility assistant otherwise. Use **Edit Profile** in the assistant to reopen profile editing.

## Voice control

Voice control is enabled by default and starts after the profile has loaded. Chrome may ask for microphone permission. Speech recognition is provided by the browser speech service; the interfaces show a retry action if permission, browser support, or connectivity prevents listening. The **Voice control** button turns listening off or back on, and the choice is saved across the two applications.

To try it, load `extension/dist` unpacked in Chrome, open AccessApply, and allow microphone access when prompted. Say **help** for commands. During onboarding, try “My name is …”, “My email is …”, then confirm the spoken email by saying “yes”; say “save my profile” when ready. In the assistant, try “read this page”, “open accessibility”, or “edit my profile”. You can also turn voice control off with the button and verify it remains off after reopening the extension. Manual controls remain available when voice recognition is unavailable.

Run the extension tests from this directory with:

```powershell
npm test
```
