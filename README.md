# MinimapSignatures — VS Code Extension

VS Code extension that renders the active source file as a 128×128 grayscale minimap, sends it to the analysis backend, and shows the predicted programming language, project, and author in a side panel.

## Paper

> **MinimapSignatures: Source-Code Identification via Grayscale Minimap Images**
> CBSoft 2026 — [paper.pdf](paper.pdf)

## Contents

```
vscode-plugin/
  src/extension.ts     — main extension entry point
  package.json         — extension manifest and npm scripts
  tsconfig.json        — TypeScript configuration
LICENSE
README.md
paper.pdf
```

## Requirements

- Node.js 18+
- npm (bundled with Node.js)
- Visual Studio Code 1.85+
- MinimapSignatures backend running on `http://localhost:8000`

## Installation

```bash
cd vscode-plugin
npm install
npm run compile
```

Open the `vscode-plugin/` folder in VS Code and press `F5` to launch the Extension Development Host. Open any source file, then run `SourceCodeMinimaps: Analyze Current File` from the Command Palette. A side panel with predictions should appear.

The backend URL and API key are defined as constants at the top of `src/extension.ts`.

## License

MIT — see [LICENSE](LICENSE).
