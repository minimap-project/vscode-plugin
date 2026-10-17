# MinimapSignatures — Artifact README

> **Paper:** MinimapSignatures: A Multi-IDE Ecosystem for Analysis of Visual Source Code Signatures
> CBSoft 2026 — [paper.pdf](paper.pdf)

---

## What is this?

**MinimapSignatures** is a research ecosystem that identifies the **programming language (type)**, **project**, and **author** of a source-code file using only a 128×128 grayscale image (a *minimap*) of that file — without reading the text of the code directly.

This artifact is part of a four-component ecosystem. Each component is independently available as a separate artifact on Zenodo:

| Component | Description |
|---|---|
| **Back-End API** | FastAPI (Python) server that receives a minimap image and returns predictions |
| **ONNX Model** | Pre-trained multitask neural network (weights + label encoders) |
| **VS Code Extension** | Extension that generates a minimap from the active file and shows predictions |
| **IntelliJ IDEA Plugin** | Plugin that generates a minimap from the active file and shows predictions |

**To use the full ecosystem, you need: the Back-End API + at least one IDE plugin.**
The ONNX Model artifact is bundled inside the Back-End API artifact and does not need to be set up separately.

---

## Repository Structure

Regardless of which artifact you opened, its root directory contains:

```
LICENSE          — open-source license for this component
README.md        — this file
paper.pdf        — accepted paper (CBSoft 2026)
<source files>   — source code for this component
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    IDE (VS Code / IntelliJ)              │
│                                                          │
│  1. Read source file text                                │
│  2. Convert each character → grayscale pixel intensity   │
│  3. Render 128×128 PNG image (minimap)                   │
│  4. Send minimap (Base64) to the Back-End API            │
│  5. Display predictions in a side panel / notification   │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP POST /api/v1/analyze/image
                       ▼
┌─────────────────────────────────────────────────────────┐
│                 Back-End API (FastAPI)                    │
│                                                          │
│  1. Decode Base64 image                                  │
│  2. Validate dimensions (must be 128×128)                │
│  3. Normalize pixel values: (x/255 − 0.5) / 0.5         │
│  4. Run ONNX multitask model                             │
│  5. Return top-3 predictions for: type, project, author  │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│             ONNX Multitask Model (~5 MB)                  │
│  Outputs: author logits | project logits | type logits   │
└─────────────────────────────────────────────────────────┘
```

---

## Modos de Análise (Analysis Strategies)

O ecossistema MinimapSignatures oferece 3 formas de análise de código-fonte:

### 1. Caminho 0 — Análise do Arquivo Atual
- **Objetivo:** Analisa o arquivo de código-fonte atualmente aberto e ativo no editor.
- **Como acessar:**
  - **VS Code:** Abra a Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`), execute `SourceCodeMinimaps: Select Analysis Strategy...` e escolha a opção do arquivo atual (ou execute diretamente `SourceCodeMinimaps: Analyze Current File`).
  - **IntelliJ IDEA:** Clique no ícone do plugin na barra de ferramentas ou clique com o botão direito no editor e escolha **MinimapSignatures → Caminho 0: Analisar Arquivo Atual** (ou via diálogo seletor de estratégias).

### 2. Caminho A — Análise Individual de Diretório
- **Objetivo:** Analisar individualmente cada arquivo elegível de um **único diretório selecionado pelo usuário**.
- **Regras e Comportamento:**
  - Exige a seleção de **um único diretório por chamada** (não analisa diretórios irmãos automaticamente).
  - Percorre recursivamente apenas os subdiretórios internos da pasta selecionada, respeitando regras de exclusão padrão (`.git`, `node_modules`, `build`, etc.).
  - Executa inferências individuais com controle de concorrência (pool de 4 requisições simultâneas para evitar sobrecarga).
  - Falhas em arquivos específicos não interrompem a operação global: os resultados válidos são preservados e as falhas contabilizadas.
- **Como acessar:**
  - **VS Code:** Na Command Palette, selecione `SourceCodeMinimaps: Select Analysis Strategy...` e escolha **Caminho A: Análise Individual de Diretório** (ou execute diretamente `SourceCodeMinimaps: Analyze Directory (Individual)`). Selecione a pasta no diálogo. Os resultados detalhados são exibidos em uma Webview interativa com opção para iniciar uma nova análise em outro diretório.
  - **IntelliJ IDEA:** Selecione **MinimapSignatures → Caminho A: Análise Individual de Diretório**. Escolha o diretório no seletor de pastas. Os resultados são exibidos em relatório Markdown com sumário de sucessos, falhas e previsões por arquivo.

### 3. Caminho B — Análise por Minimap Médio do Projeto
- **Objetivo:** Produzir uma previsão global para o projeto a partir da extensão de arquivo predominante.
- **Como a imagem média é construída:**
  1. O plugin identifica e varre todos os arquivos de código elegíveis do projeto (respeitando exclusões).
  2. Agrupa os arquivos por extensão e determina qual é a **extensão mais frequente** (com maior número de arquivos elegíveis).
  3. Para cada arquivo pertencente a essa extensão predominante, gera sua representação matricial de minimap $128 \times 128$ em escala de cinza (com padding de 8px e codificação padrão de caracteres).
  4. Calcula a **média aritmética pixel a pixel**:
     $$\text{pixel}_{\text{médio}}[x, y] = \text{round}\left(\frac{1}{N} \sum_{i=1}^N \text{pixel}_i[x, y]\right)$$
     onde $N$ é o total de arquivos agregados daquela extensão. A média é calculada diretamente sobre os valores dos pixels, e não sobre as probabilidades das previsões.
  5. Codifica a imagem resultante de $128 \times 128$ em PNG (Base64) e envia ao endpoint existente do modelo (`/api/v1/analyze/image`).
  6. Apresenta a quantidade de arquivos utilizados na agregação e as previsões globais retornadas pelo modelo (`type`, `project`, `author`).
- **Como acessar:**
  - **VS Code:** Na Command Palette, escolha `SourceCodeMinimaps: Select Analysis Strategy...` e clique em **Caminho B: Análise por Minimap Médio** (ou execute diretamente `SourceCodeMinimaps: Analyze Project (Average Minimap)`).
  - **IntelliJ IDEA:** Selecione **MinimapSignatures → Caminho B: Análise por Minimap Médio**.

---

## Prerequisites

Install **all** of the following before proceeding.

### Back-End API

| Requirement | Version | Notes |
|---|---|---|
| Python | 3.10 or newer | `python3 --version` |
| pip | bundled with Python | `pip --version` |
| (Optional) Docker | any recent version | alternative to Python setup |

### VS Code Extension

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 18 or newer | `node --version` |
| npm | bundled with Node.js | `npm --version` |
| Visual Studio Code | 1.85 or newer | — |
| Back-End API | running on port 8000 | must be started first |

### IntelliJ IDEA Plugin

| Requirement | Version | Notes |
|---|---|---|
| JDK | **21** (exactly) | `java -version` |
| IntelliJ IDEA | 2023.1 or newer (Community or Ultimate) | — |
| Back-End API | running on port 8000 | must be started first |

> **Note for macOS / Linux users:** The `gradlew` wrapper script may have Windows-style line endings (CRLF). If you see the error `bad interpreter: /bin/sh^M`, run the following commands once before building:
> ```bash
> # Run from: intellij-plugin/
> sed -i 's/\r//' gradlew
> chmod +x gradlew
> ```


### Official Download Links

Use the official links below to install the prerequisites:

| Requirement | Used by | Version | Download |
|---|---|---:|---|
| Python | Back-End API | 3.10 or newer | [Download Python](https://www.python.org/downloads/) |
| pip and venv | Back-End API | Included with Python | [venv documentation](https://docs.python.org/3/library/venv.html) · [pip installation](https://pip.pypa.io/en/stable/installation/) |
| Docker Desktop | Back-End API alternative | Latest version | [Download Docker Desktop](https://www.docker.com/products/docker-desktop/) |
| Node.js | VS Code Extension | 18 or newer | [Download Node.js](https://nodejs.org/en/download/) |
| npm | VS Code Extension | Included with Node.js | [npm documentation](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) |
| Visual Studio Code | VS Code Extension | 1.118.0 or newer | [Download Visual Studio Code](https://code.visualstudio.com/download) |
| JDK | IntelliJ IDEA Plugin | **21** | [Download Eclipse Temurin JDK 21](https://adoptium.net/temurin/releases/?version=21) |
| IntelliJ IDEA | IntelliJ IDEA Plugin | 2025.3.1 or compatible | [Download IntelliJ IDEA](https://www.jetbrains.com/idea/download/) |
| Gradle | IntelliJ IDEA Plugin | Not required globally | [Gradle Wrapper documentation](https://docs.gradle.org/current/userguide/gradle_wrapper.html) |

> **Note:** The IntelliJ plugin includes a Gradle Wrapper (`gradlew`/`gradlew.bat`), so you do not need to install Gradle manually. The wrapper downloads the configured Gradle version automatically.

### Which prerequisites are needed?

- To run only the **Back-End API with Python**, install Python, pip, and venv.
- To run the **Back-End API with Docker**, install Docker Desktop instead of setting up Python locally.
- To run the **VS Code Extension**, install Node.js, npm, Visual Studio Code, and start the Back-End API first.
- To run the **IntelliJ IDEA Plugin**, install JDK 21 and start the Back-End API first.
- The `model/` folder does not require any additional installation. It contains the ONNX model used by the Back-End API.

---

## Step-by-Step Setup

### Step 1 — Start the Back-End API

The Back-End API must be running **before** you use any IDE plugin.

**Option A — Python (recommended for development)**

```bash
# Run from: back-end/

# 1. Create and activate a virtual environment
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Set the API key
cp .env.example .env
# Open .env and set: API_KEY=m1n1m4p-pesquisa-2025

# 4. Start the server
uvicorn main:app --reload
```

**Option B — Docker**

```bash
# Run from: back-end/

docker build -t minimap-backend .
docker run -p 8000:8000 -e API_KEY=m1n1m4p-pesquisa-2025 minimap-backend
```

**Verify the server is running:**

```bash
# Run from: any directory

curl http://localhost:8000/
```

Expected output:

```json
{"status":"online","engine":"onnx-multitask"}
```

---

### Step 2A — Run the VS Code Extension

```bash
# Run from: vscode-plugin/

# 1. Install dependencies
npm install

# 2. Compile the TypeScript source
npm run compile
```

Then:

1. Open the `vscode-plugin` folder in VS Code.
2. Press `F5` to launch the **Extension Development Host** (a new VS Code window opens with the extension active).
3. In the new window, open any source-code file.
4. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run:
   **`SourceCodeMinimaps: Analyze Current File`**
5. A side panel will appear with the top-3 predictions for **type**, **project**, and **author**.

> **If `F5` does not open the Extension Development Host:**
>
> On macOS, you may need to press `Fn + F5`. Alternatively, open a terminal inside the `vscode-plugin` folder and run the command for your operating system:
>
> **macOS, Linux, or Git Bash:**
>
> ```bash
> code --new-window --extensionDevelopmentPath="$(pwd)"
> ```
>
> **Windows PowerShell:**
>
> ```powershell
> code --new-window --extensionDevelopmentPath="$PWD"
> ```
>
> **Windows Command Prompt:**
>
> ```cmd
> code --new-window --extensionDevelopmentPath="%cd%"
> ```
>
> This command opens a new VS Code window with the extension loaded in development mode.
>
> If the terminal reports `code: command not found`, open the VS Code Command Palette and run:
>
> ```text
> Shell Command: Install 'code' command in PATH
> ```
>
> Then restart the terminal and run the command again.


---

### Step 2B — Run the IntelliJ IDEA Plugin

> **Requirement:** JDK 21 must be installed and selected in IntelliJ (File → Project Structure → SDK).

```bash
# Run from: intellij-plugin/

# macOS / Linux — fix line endings first (one-time only)
sed -i 's/\r//' gradlew
chmod +x gradlew

# Build and launch a sandbox IntelliJ IDE with the plugin active
./gradlew runIde

# Windows
gradlew.bat runIde
```

Then:

1. A sandbox IntelliJ IDEA window will open with the plugin enabled.
2. Open any source-code file in the sandbox IDE.
3. Right-click inside the editor and select **MinimapSignatures: Analyse**.
4. A balloon notification will appear with the top-3 predictions.

---

## Validating the Full Workflow

You can validate that the back-end is working end-to-end using only `curl` and `python3`, without any IDE:

```bash
# Run from: any directory

# Step 1 — Generate a minimal 128×128 grayscale PNG and print it as Base64
python3 - <<'EOF'
import struct, zlib, base64

def png_128x128_gray(intensity=100):
    w, h = 128, 128
    raw = b"".join(b"\x00" + bytes([intensity] * w) for _ in range(h))
    def chunk(tag, data):
        c = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", c)
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(raw))
    iend = chunk(b"IEND", b"")
    return b"\x89PNG\r\n\x1a\n" + ihdr + idat + iend

print(base64.b64encode(png_128x128_gray()).decode())
EOF
```

Copy the Base64 string printed above, then send it to the API:

```bash
# Run from: any directory

# Step 2 — Send to the API (replace <BASE64> with the string from Step 1)
curl -s -X POST http://localhost:8000/api/v1/analyze/image \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: m1n1m4p-pesquisa-2025" \
  -d '{
    "project": "test",
    "hash":    "abc123",
    "image":   "<BASE64>"
  }' | python3 -m json.tool
```

Expected output structure (predicted classes will vary):

```json
{
  "hash": "abc123",
  "predict": [
    {
      "target": "type",
      "predictions": [
        {"class": "java",   "confidence": 0.45},
        {"class": "python", "confidence": 0.30},
        {"class": "kotlin", "confidence": 0.25}
      ]
    },
    {
      "target": "project",
      "predictions": [...]
    },
    {
      "target": "author",
      "predictions": [...]
    }
  ]
}
```

All returned targets — `type`, `project`, and `author` — are produced by the trained ONNX model.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `{"detail":"Token inválido"}` | Wrong or missing API key | Make sure `X-Api-Key: m1n1m4p-pesquisa-2025` is in the request header |
| `{"detail":"Imagem deve ser 128x128"}` | Image is not exactly 128×128 px | Resize the image before encoding |
| `{"detail":"Base64 inválido"}` | Malformed Base64 string | Re-encode the image |
| `Connection refused` on port 8000 | Back-End API is not running | Complete Step 1 before running any plugin |
| `bad interpreter: /bin/sh^M` | `gradlew` has Windows line endings (CRLF) | Run `sed -i 's/\r//' gradlew && chmod +x gradlew` |
| `Could not resolve com.jetbrains...` | No internet connection during Gradle sync | Run `./gradlew runIde` with an active internet connection |
| VS Code `F5` shows no Extension Host | TypeScript not compiled | Run `npm run compile` first, then press `F5` |

---

## License Notes

- **Back-End API**, **VS Code Extension**, **IntelliJ IDEA Plugin**: MIT License — see [LICENSE](LICENSE)
- **ONNX Model**: Creative Commons Attribution 4.0 (CC BY 4.0) — see [Model License](../model/LICENSE)
- Trained on public GitHub repositories. No personally identifiable information beyond public GitHub usernames is encoded in the model weights.
- Intended for research and reproducibility purposes only.
