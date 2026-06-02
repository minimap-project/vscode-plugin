# SourceCodeMinimaps — VS Code Extension

VS Code extension for the MinimapSignatures ecosystem
(https://github.com/minimap-project). It renders the active source file as a
128x128 grayscale minimap, sends it to the analysis backend, and shows the
predicted programming language, project, and author in a side panel.

## How it works

1. Reads the active file and renders a 128x128 grayscale minimap, mapping each
   character to a pixel intensity (the same encoding used to train the model).
2. Encodes the image as a base64 PNG and computes an MD5 hash of the file path.
3. Sends a POST request to the backend and displays the ranked predictions in a
   webview panel.

## Requirements

- Node.js and npm.
- A running analysis backend. Start the `back-end-pytorch` service first; by
  default this extension calls `http://localhost:8000/api/v1/analyze/image`.

## Setup

```bash
npm install
npm run compile
```

## Running in development

1. Make sure the backend is running on `http://localhost:8000`.
2. Open this folder in VS Code and press `F5` to launch the Extension
   Development Host.
3. In the new window, open and save a source file.
4. Open the Command Palette and run `SourceCodeMinimaps: Analyze Current File`.

The result panel opens beside the editor with one card per target
(type, project, author, quality).

## Configuration

The backend URL and API key are defined as constants at the top of
`src/extension.ts` (`ENDPOINT` and `API_KEY`). Change `ENDPOINT` if your backend
runs on a different host or port. After editing, run `npm run compile` (or keep
`npm run watch` running) so `out/extension.js` is regenerated.

During development the extension also saves each generated minimap under a
`sourcecodeminimaps/` folder in the open workspace, which is useful for
inspecting exactly what is sent to the backend. Set
`SAVE_MINIMAP_IMAGES_FOR_DEVELOPMENT` to `false` in `src/extension.ts` to
disable this.
