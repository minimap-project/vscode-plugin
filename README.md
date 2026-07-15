# MinimapSignatures — VS Code Extension

VS Code extension for the MinimapSignatures ecosystem. It renders the active
source file as a 128×128 grayscale minimap image, sends it to the analysis
backend, and shows the ranked predictions for programming language, project,
and author in a dedicated side panel.

## Paper

This artifact is associated with the following accepted paper:

> **MinimapSignatures: Source-Code Identification via Grayscale Minimap Images**  
> CBSoft 2026  
> [📄 paper.pdf](paper.pdf)

## Repository Organisation

```
vscode-plugin/     ← source code (TypeScript / Node.js extension)
LICENSE            ← MIT License
README.md          ← this file
paper.pdf          ← accepted paper
```

The `vscode-plugin/` subdirectory contains:
- `src/extension.ts` — main extension entry point; contains `ENDPOINT` and
  `API_KEY` constants, image encoding logic, and the webview panel
- `package.json` — extension manifest and npm scripts
- `tsconfig.json` — TypeScript compiler configuration
- `eslint.config.mjs` — ESLint configuration
- `.vscodeignore` — files excluded from the packaged extension
- `CHANGELOG.md` — version history

## Requirements

- **Node.js 18** or newer
- **npm** (bundled with Node.js)
- **Visual Studio Code 1.85** or newer
- A running instance of the **MinimapSignatures backend** on
  `http://localhost:8000` (see the `back-end` artifact)

## Installation

### Running in development mode

```bash
# 1. Install dependencies
cd vscode-plugin
npm install

# 2. Compile the TypeScript source
npm run compile

# 3. Make sure the backend is running on http://localhost:8000

# 4. Open the vscode-plugin/ folder in VS Code and press F5
#    to launch the Extension Development Host
```

**Verify the installation:**

1. A new VS Code window (Extension Development Host) opens.
2. Open any source file.
3. Open the Command Palette (`Ctrl+Shift+P`) and run:
   `SourceCodeMinimaps: Analyze Current File`
4. A side panel opens showing one prediction card per target
   (type, project, author, quality).

### Configuration

The backend URL and API key are constants at the top of
`vscode-plugin/src/extension.ts` (`ENDPOINT` and `API_KEY`). Adjust
`ENDPOINT` if your backend runs on a different host or port, then recompile:

```bash
npm run compile
# or keep a watcher running during development:
npm run watch
```

During development the extension also saves each generated minimap under a
`sourcecodeminimaps/` folder in the open workspace, which is useful for
inspecting the images sent to the backend. Set
`SAVE_MINIMAP_IMAGES_FOR_DEVELOPMENT` to `false` in `src/extension.ts` to
disable this behaviour.

## License

This artifact is distributed under the **MIT License** — see [`LICENSE`](LICENSE).
