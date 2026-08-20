# Second Brain Capture (browser extension)

A one-click capture extension: sends the current page (or a text
selection) into your Second Brain Inbox. It's a thin client on top of
`POST /captures` (`apps/api/routers/captures.py`), the endpoint already
built for scripted capture sources - no separate backend for this.

## Setup

1. Generate a personal access token from the app: **Settings -> API
   tokens -> New token**. Copy it immediately - it's shown once.
2. Build the extension:
   ```bash
   cd apps/extension
   npm install
   npm run build
   ```
3. Load it in Chrome: `chrome://extensions` -> enable **Developer mode**
   -> **Load unpacked** -> select `apps/extension/dist`.
4. Click the extension's toolbar icon -> **Set up API URL & token** ->
   enter your API's URL (e.g. `http://localhost:8001` locally, or your
   deployed `api.yourdomain.com`) and the token from step 1 -> **Save**.
   Chrome will ask you to confirm permission for that one URL - that's
   the extension requesting host access only for the API origin you
   just typed in, not for every site you visit.

## Using it

- **Toolbar icon** -> "Capture this page": sends the current tab's URL,
  plus an optional note if you type one.
- **Right-click a text selection** -> "Add selection to Second Brain":
  sends the selected text plus the page URL, with a desktop
  notification on success/failure (works even if you don't reopen the
  popup).

Either way, the capture shows up in the app's Inbox exactly like one
made from the app itself - same pipeline, same `needs review` handling
if the pipeline can't confidently place it.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run build        # esbuild -> dist/, then reload the unpacked extension
```

No dev server: `dist/` is loaded directly via "Load unpacked", so a
rebuild + a manual reload in `chrome://extensions` (or clicking the
extension's own reload icon there) is the whole loop.

## Explicitly out of scope for this pass

- Chrome Web Store publishing (needs a developer account and their
  review process - a follow-up once this is validated locally).
- Firefox/Safari ports.
- Capturing full page content or screenshots - v1 sends URL + title +
  an optional note/selection, matching what the pipeline already knows
  how to do with `kind: url` / `kind: text` captures.
