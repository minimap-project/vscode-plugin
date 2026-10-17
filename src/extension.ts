import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';

const ENDPOINT = 'http://localhost:8000/api/v1/analyze/image';
const API_KEY = 'm1n1m4p-pesquisa-2025';

const IMAGE_WIDTH = 128;
const IMAGE_HEIGHT = 128;
const PADDING = 8;
const UNKNOWN_PROJECT_NAME = 'UNKNOWN';

const SAVE_MINIMAP_IMAGES_FOR_DEVELOPMENT = true;
const DIRECTORY_ANALYSIS_CONCURRENCY = 4;

const IGNORED_DIRS = new Set([
    'node_modules',
    '.git',
    '.svn',
    '.hg',
    '.vscode',
    '.idea',
    '.gradle',
    'build',
    'dist',
    'out',
    'target',
    'venv',
    '.venv',
    'env',
    '.env',
    '__pycache__',
    'sourcecodeminimaps'
]);

const SUPPORTED_EXTENSIONS = new Set([
    '.py', '.java', '.kt', '.kts', '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp',
    '.cs', '.go', '.rs', '.rb', '.php', '.js', '.jsx', '.ts', '.tsx',
    '.scala', '.swift', '.dart', '.lua', '.r', '.sh', '.bash', '.sql',
    '.html', '.htm', '.css', '.scss', '.sass', '.less', '.json', '.yaml',
    '.yml', '.xml', '.toml', '.md', '.markdown', '.ini', '.properties',
    '.clj', '.coffee', '.cmake', '.graphql', '.groovy', '.jl', '.m', '.mm',
    '.pl', '.pm', '.ps1', '.rst', '.vue'
]);

type ApiPrediction = {
    class: string;
    confidence: number;
};

type ApiPredictionGroup = {
    target: string;
    predictions: ApiPrediction[];
};

type ApiResponse = {
    hash: string;
    predict: ApiPredictionGroup[];
};

type FileAnalysisSuccess = {
    file: string;
    fullPath: string;
    success: true;
    fileHash: string;
    apiResponse: ApiResponse;
};

type FileAnalysisFailure = {
    file: string;
    fullPath: string;
    success: false;
    error: string;
};

type FileAnalysisItem = FileAnalysisSuccess | FileAnalysisFailure;

export function activate(context: vscode.ExtensionContext): void {
    const chooseAnalysisCommand = vscode.commands.registerCommand(
        'sourcecodeminimapsplugin.chooseAnalysis',
        chooseAnalysisStrategy
    );

    const analyzeCurrentFileCommand = vscode.commands.registerCommand(
        'sourcecodeminimapsplugin.analyzeCurrentFile',
        analyzeCurrentFile
    );

    const analyzeDirectoryCommand = vscode.commands.registerCommand(
        'sourcecodeminimapsplugin.analyzeDirectory',
        analyzeDirectory
    );

    const analyzeProjectAverageCommand = vscode.commands.registerCommand(
        'sourcecodeminimapsplugin.analyzeProjectAverage',
        analyzeProjectAverage
    );

    context.subscriptions.push(
        chooseAnalysisCommand,
        analyzeCurrentFileCommand,
        analyzeDirectoryCommand,
        analyzeProjectAverageCommand
    );
}

export function deactivate(): void {}

// ---------------------------------------------------------------------------
// Menu de seleção da estratégia
// ---------------------------------------------------------------------------

async function chooseAnalysisStrategy(): Promise<void> {
    const choices: (vscode.QuickPickItem & { strategy: 'file' | 'dir' | 'average' })[] = [
        {
            label: '$(file-code) Caminho 0: Analisar Arquivo Atual',
            description: 'Arquivo aberto no editor',
            detail: 'Gera o minimap do arquivo atual aberto e consulta a inferência.',
            strategy: 'file'
        },
        {
            label: '$(folder) Caminho A: Análise Individual de Diretório',
            description: 'Arquivos elegíveis de uma única pasta',
            detail: 'Solicita a seleção de um único diretório e analisa cada arquivo individualmente.',
            strategy: 'dir'
        },
        {
            label: '$(graph) Caminho B: Análise por Minimap Médio',
            description: 'Extensão predominante do projeto',
            detail: 'Identifica a extensão mais frequente no projeto e executa a inferência sobre a imagem agregada.',
            strategy: 'average'
        }
    ];

    const selected = await vscode.window.showQuickPick(choices, {
        placeHolder: 'Selecione a estratégia de análise MinimapSignatures:'
    });

    if (!selected) {
        return;
    }

    switch (selected.strategy) {
        case 'file':
            await analyzeCurrentFile();
            break;
        case 'dir':
            await analyzeDirectory();
            break;
        case 'average':
            await analyzeProjectAverage();
            break;
    }
}

// ---------------------------------------------------------------------------
// Caminho 0 — Análise do Arquivo Atual
// ---------------------------------------------------------------------------

async function analyzeCurrentFile(): Promise<void> {
    try {
        const editor = vscode.window.activeTextEditor;

        if (!editor) {
            vscode.window.showWarningMessage('No file is currently open.');
            return;
        }

        const document = editor.document;

        if (document.isUntitled) {
            vscode.window.showWarningMessage('Please save the file before analyzing it.');
            return;
        }

        const sourceCode = document.getText();
        const relativePath = getRelativeFilePath(document.uri);
        const projectName = getProjectName(document.uri);
        const fileHash = createMd5Hash(relativePath);

        const pngBuffer = createSourceCodeMinimapPng(sourceCode);

        if (SAVE_MINIMAP_IMAGES_FOR_DEVELOPMENT) {
            await saveMinimapImageForDevelopment(fileHash, pngBuffer);
        }

        const imageBase64 = pngBuffer.toString('base64');

        const requestPayload = {
            project: projectName,
            hash: fileHash,
            image: imageBase64
        };

        vscode.window.setStatusBarMessage(
            'SourceCodeMinimapsPlugin: sending source code minimap...',
            5000
        );

        const apiResponse = await sendMinimapToApi(requestPayload);

        await showAnalysisResult({
            projectName,
            relativePath,
            fileHash,
            apiResponse
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`SourceCodeMinimapsPlugin error: ${errorMessage}`);
    }
}

// ---------------------------------------------------------------------------
// Caminho A — Análise Individual de Diretório
// ---------------------------------------------------------------------------

async function analyzeDirectory(): Promise<void> {
    try {
        const folderUris = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            title: 'Selecione um único diretório para análise individual',
            openLabel: 'Selecionar Diretório'
        });

        if (!folderUris || folderUris.length === 0) {
            return;
        }

        const selectedFolderUri = folderUris[0];
        const selectedDirPath = selectedFolderUri.fsPath;
        const projectName = getProjectName(selectedFolderUri);

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'MinimapSignatures: Análise Individual de Diretório',
                cancellable: true
            },
            async (progress, token) => {
                progress.report({ message: 'Buscando arquivos elegíveis...' });

                const eligibleFiles = await findEligibleFilesInDirectory(selectedDirPath);

                if (eligibleFiles.length === 0) {
                    vscode.window.showWarningMessage(
                        `Nenhum arquivo elegível encontrado no diretório: ${selectedDirPath}`
                    );
                    return;
                }

                const total = eligibleFiles.length;
                let processed = 0;
                let failedCount = 0;

                const results: FileAnalysisItem[] = new Array(total);

                // Controle de concorrência com pool de workers
                let nextIndex = 0;
                const worker = async (): Promise<void> => {
                    while (nextIndex < total) {
                        if (token.isCancellationRequested) {
                            break;
                        }

                        const idx = nextIndex++;
                        const filePath = eligibleFiles[idx];
                        const relativePath = path
                            .relative(selectedDirPath, filePath)
                            .replace(/\\/g, '/');

                        try {
                            const content = await fs.promises.readFile(filePath, 'utf8');
                            const pngBuffer = createSourceCodeMinimapPng(content);
                            const fileHash = createMd5Hash(`${relativePath}:${content}`);

                            if (SAVE_MINIMAP_IMAGES_FOR_DEVELOPMENT) {
                                await saveMinimapImageForDevelopment(fileHash, pngBuffer);
                            }

                            const apiResponse = await sendMinimapToApi({
                                project: projectName,
                                hash: fileHash,
                                image: pngBuffer.toString('base64')
                            });

                            results[idx] = {
                                file: relativePath,
                                fullPath: filePath,
                                success: true,
                                fileHash,
                                apiResponse
                            };
                        } catch (err) {
                            failedCount++;
                            const errorMsg = err instanceof Error ? err.message : String(err);
                            results[idx] = {
                                file: relativePath,
                                fullPath: filePath,
                                success: false,
                                error: errorMsg
                            };
                        } finally {
                            processed++;
                            progress.report({
                                increment: (1 / total) * 100,
                                message: `${processed}/${total} processados (${failedCount} falhas)`
                            });
                        }
                    }
                };

                const workerCount = Math.min(DIRECTORY_ANALYSIS_CONCURRENCY, total);
                await Promise.all(Array.from({ length: workerCount }, () => worker()));

                if (token.isCancellationRequested) {
                    vscode.window.showWarningMessage('Análise de diretório cancelada pelo usuário.');
                }

                const validItems = results.filter((item): item is FileAnalysisItem => item !== undefined);

                await showDirectoryAnalysisResult({
                    directoryPath: selectedDirPath,
                    projectName,
                    totalFound: total,
                    processedCount: validItems.length,
                    successCount: validItems.filter(i => i.success).length,
                    failedCount: validItems.filter(i => !i.success).length,
                    items: validItems
                });
            }
        );
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Erro na análise de diretório: ${errorMessage}`);
    }
}

// ---------------------------------------------------------------------------
// Caminho B — Análise por Minimap Médio do Projeto
// ---------------------------------------------------------------------------

async function analyzeProjectAverage(): Promise<void> {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('Nenhum workspace aberto no VS Code.');
            return;
        }

        let selectedWorkspace = workspaceFolders[0];
        if (workspaceFolders.length > 1) {
            const picked = await vscode.window.showWorkspaceFolderPick({
                placeHolder: 'Selecione a pasta do projeto para análise por minimap médio:'
            });
            if (!picked) {
                return;
            }
            selectedWorkspace = picked;
        }

        const projectRoot = selectedWorkspace.uri.fsPath;
        const projectName = selectedWorkspace.name;

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'MinimapSignatures: Análise por Minimap Médio',
                cancellable: false
            },
            async (progress) => {
                progress.report({ message: 'Varrendo arquivos elegíveis do projeto...' });

                const eligibleFiles = await findEligibleFilesInDirectory(projectRoot);

                if (eligibleFiles.length === 0) {
                    vscode.window.showWarningMessage(
                        `Nenhum arquivo de código elegível encontrado no projeto ${projectName}.`
                    );
                    return;
                }

                // Agrupamento por extensão para encontrar a mais frequente
                const filesByExtension = new Map<string, string[]>();
                for (const filePath of eligibleFiles) {
                    const ext = path.extname(filePath).toLowerCase() || path.basename(filePath).toLowerCase();
                    const group = filesByExtension.get(ext) ?? [];
                    group.push(filePath);
                    filesByExtension.set(ext, group);
                }

                // Encontrar extensão com maior quantidade de arquivos
                let predominantExt = '';
                let maxFiles: string[] = [];
                for (const [ext, files] of filesByExtension.entries()) {
                    if (files.length > maxFiles.length) {
                        predominantExt = ext;
                        maxFiles = files;
                    }
                }

                progress.report({
                    message: `Construindo imagem média para ${maxFiles.length} arquivos da extensão '${predominantExt}'...`
                });

                // Construção da imagem média: soma aritmética pixel a pixel
                const sumPixels = new Float64Array(IMAGE_WIDTH * IMAGE_HEIGHT);
                let validCount = 0;
                let readFailures = 0;

                for (const filePath of maxFiles) {
                    try {
                        const content = await fs.promises.readFile(filePath, 'utf8');
                        const pixels = getMinimapPixels(content);
                        for (let i = 0; i < pixels.length; i++) {
                            sumPixels[i] += pixels[i];
                        }
                        validCount++;
                    } catch {
                        readFailures++;
                    }
                }

                if (validCount === 0) {
                    throw new Error(`Não foi possível ler os arquivos da extensão '${predominantExt}'.`);
                }

                const avgPixels = new Uint8Array(IMAGE_WIDTH * IMAGE_HEIGHT);
                for (let i = 0; i < avgPixels.length; i++) {
                    avgPixels[i] = Math.round(sumPixels[i] / validCount);
                }

                const avgPngBuffer = pixelsToPngBuffer(avgPixels);
                const avgHash = createMd5Hash(`average:${projectName}:${predominantExt}:${validCount}`);

                if (SAVE_MINIMAP_IMAGES_FOR_DEVELOPMENT) {
                    await saveMinimapImageForDevelopment(avgHash, avgPngBuffer);
                }

                progress.report({ message: 'Enviando minimap médio para inferência...' });

                const imageBase64 = avgPngBuffer.toString('base64');
                const apiResponse = await sendMinimapToApi({
                    project: projectName,
                    hash: avgHash,
                    image: imageBase64
                });

                await showAverageAnalysisResult({
                    projectName,
                    projectRoot,
                    predominantExt,
                    totalEligibleInProject: eligibleFiles.length,
                    filesAggregated: validCount,
                    readFailures,
                    avgHash,
                    imageBase64,
                    apiResponse
                });
            }
        );
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Erro na análise por minimap médio: ${errorMessage}`);
    }
}

// ---------------------------------------------------------------------------
// Identificação de arquivos elegíveis
// ---------------------------------------------------------------------------

async function findEligibleFilesInDirectory(directoryPath: string): Promise<string[]> {
    const results: string[] = [];

    async function scan(currentDir: string): Promise<void> {
        let entries: fs.Dirent[];
        try {
            entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);

            if (entry.isDirectory()) {
                if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) {
                    continue;
                }
                await scan(fullPath);
            } else if (entry.isFile()) {
                if (entry.name.startsWith('.')) {
                    continue;
                }
                const ext = path.extname(entry.name).toLowerCase();
                const baseName = entry.name.toLowerCase();
                if (SUPPORTED_EXTENSIONS.has(ext) || baseName === 'dockerfile' || baseName === 'makefile') {
                    results.push(fullPath);
                }
            }
        }
    }

    await scan(directoryPath);
    return results.sort();
}

// ---------------------------------------------------------------------------
// Geração de Minimap
// ---------------------------------------------------------------------------

function convertCharacterToPixelIntensity(character: string): number {
    const ascii = character.charCodeAt(0);

    // Caracteres de controle (newline, tab, etc.) → preto
    if (ascii < 32) {
        return 0;
    }

    // Dígitos → cinza fixo 53
    if (ascii >= 48 && ascii <= 57) {
        return 53;
    }

    // Letras maiúsculas → cinza fixo 77
    if (ascii >= 65 && ascii <= 90) {
        return 77;
    }

    // Letras minúsculas → cinza fixo 109
    if (ascii >= 97 && ascii <= 122) {
        return 109;
    }

    // Outros caracteres (espaço=32, pontuação, símbolos) → valor ASCII cru
    return ascii;
}

function getMinimapPixels(sourceCode: string): Uint8Array {
    const pixels = new Uint8Array(IMAGE_WIDTH * IMAGE_HEIGHT);

    const normalizedSourceCode = sourceCode
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');

    const sourceLines = normalizedSourceCode.split('\n');

    for (let row = 0; row < IMAGE_HEIGHT; row++) {
        for (let column = 0; column < IMAGE_WIDTH; column++) {
            const pixelIndex = row * IMAGE_WIDTH + column;

            if (row < PADDING || column < PADDING) {
                pixels[pixelIndex] = 0;
                continue;
            }

            const sourceRow = row - PADDING;
            const sourceCol = column - PADDING;
            const sourceLine = sourceLines[sourceRow] ?? '';
            const character = sourceLine[sourceCol];

            pixels[pixelIndex] = character === undefined
                ? 0
                : convertCharacterToPixelIntensity(character);
        }
    }

    return pixels;
}

function pixelsToPngBuffer(pixels: Uint8Array): Buffer {
    const png = new PNG({
        width: IMAGE_WIDTH,
        height: IMAGE_HEIGHT
    });

    for (let i = 0; i < pixels.length; i++) {
        const pixelIndex = i * 4;
        const val = pixels[i];
        png.data[pixelIndex]     = val;
        png.data[pixelIndex + 1] = val;
        png.data[pixelIndex + 2] = val;
        png.data[pixelIndex + 3] = 255;
    }

    return PNG.sync.write(png);
}

function createSourceCodeMinimapPng(sourceCode: string): Buffer {
    const pixels = getMinimapPixels(sourceCode);
    return pixelsToPngBuffer(pixels);
}

// ---------------------------------------------------------------------------
// Integração com a API
// ---------------------------------------------------------------------------

async function sendMinimapToApi(requestPayload: {
    project: string;
    hash: string;
    image: string;
}): Promise<ApiResponse> {
    const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': API_KEY
        },
        body: JSON.stringify(requestPayload)
    });

    if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`HTTP ${response.status}: ${responseText}`);
    }

    return await response.json() as ApiResponse;
}

// ---------------------------------------------------------------------------
// Utilitários de Hash, Projetos e Imagens
// ---------------------------------------------------------------------------

function getProjectName(fileUri: vscode.Uri): string {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
    if (!workspaceFolder) {
        return UNKNOWN_PROJECT_NAME;
    }
    return workspaceFolder.name;
}

function getRelativeFilePath(fileUri: vscode.Uri): string {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
    if (!workspaceFolder) {
        return fileUri.fsPath.replace(/\\/g, '/');
    }
    return vscode.workspace.asRelativePath(fileUri, false).replace(/\\/g, '/');
}

function createMd5Hash(value: string): string {
    return crypto
        .createHash('md5')
        .update(value, 'utf8')
        .digest('hex');
}

async function saveMinimapImageForDevelopment(
    fileHash: string,
    pngBuffer: Buffer
): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return;
    }

    const outputFolderUri = vscode.Uri.joinPath(
        workspaceFolder.uri,
        'sourcecodeminimaps'
    );

    try {
        await vscode.workspace.fs.createDirectory(outputFolderUri);
        const outputFileUri = vscode.Uri.joinPath(outputFolderUri, `${fileHash}.png`);
        await vscode.workspace.fs.writeFile(outputFileUri, pngBuffer);
    } catch {
        // Falha silenciosa ao gravar imagem de desenvolvimento se diretório for somente leitura
    }
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/&/g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ---------------------------------------------------------------------------
// Telas de Apresentação (Webviews)
// ---------------------------------------------------------------------------

async function showAnalysisResult(result: {
    projectName: string;
    relativePath: string;
    fileHash: string;
    apiResponse: ApiResponse;
}): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
        'sourceCodeMinimapsResult',
        'SourceCodeMinimaps Result',
        vscode.ViewColumn.Beside,
        { enableScripts: false }
    );

    panel.webview.html = buildAnalysisResultHtml(result);
}

function buildAnalysisResultHtml(result: {
    projectName: string;
    relativePath: string;
    fileHash: string;
    apiResponse: ApiResponse;
}): string {
    const groupsHtml = result.apiResponse.predict.map(group => {
        const predictionsHtml = group.predictions.map(prediction => {
            const percent = (prediction.confidence * 100).toFixed(2);
            return `
                <div class="prediction-row">
                    <span class="class-name">${escapeHtml(prediction.class)}</span>
                    <span class="confidence">${percent}%</span>
                </div>
                <div class="bar">
                    <div class="bar-fill" style="width: ${percent}%"></div>
                </div>
            `;
        }).join('');

        return `
            <section class="card">
                <h2>${escapeHtml(group.target)}</h2>
                ${predictionsHtml}
            </section>
        `;
    }).join('');

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background: var(--vscode-editor-background);
                    padding: 24px;
                }
                h1 { margin-top: 0; font-size: 22px; }
                .meta {
                    padding: 14px;
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 10px;
                    margin-bottom: 18px;
                    background: var(--vscode-sideBar-background);
                }
                .meta div { margin: 6px 0; }
                .grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
                    gap: 16px;
                }
                .card {
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 12px;
                    padding: 16px;
                    background: var(--vscode-sideBar-background);
                }
                .card h2 { margin-top: 0; text-transform: capitalize; font-size: 18px; }
                .prediction-row {
                    display: flex;
                    justify-content: space-between;
                    margin-top: 12px;
                    font-size: 14px;
                }
                .class-name { font-weight: 600; }
                .confidence { opacity: 0.85; }
                .bar {
                    height: 8px;
                    border-radius: 999px;
                    background: var(--vscode-editorWidget-background);
                    overflow: hidden;
                    margin-top: 5px;
                }
                .bar-fill {
                    height: 100%;
                    background: var(--vscode-progressBar-background);
                }
                code { word-break: break-all; }
            </style>
        </head>
        <body>
            <h1>SourceCodeMinimaps: Análise do Arquivo</h1>
            <div class="meta">
                <div><strong>Project:</strong> ${escapeHtml(result.projectName)}</div>
                <div><strong>File:</strong> <code>${escapeHtml(result.relativePath)}</code></div>
                <div><strong>MD5:</strong> <code>${escapeHtml(result.fileHash)}</code></div>
                <div><strong>Returned hash:</strong> <code>${escapeHtml(result.apiResponse.hash)}</code></div>
            </div>
            <div class="grid">
                ${groupsHtml}
            </div>
        </body>
        </html>
    `;
}

async function showDirectoryAnalysisResult(data: {
    directoryPath: string;
    projectName: string;
    totalFound: number;
    processedCount: number;
    successCount: number;
    failedCount: number;
    items: FileAnalysisItem[];
}): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
        'sourceCodeMinimapsDirectoryResult',
        'Minimaps: Análise Individual de Diretório',
        vscode.ViewColumn.Beside,
        {
            enableScripts: true
        }
    );

    panel.webview.onDidReceiveMessage(async (message) => {
        if (message.command === 'analyzeAnother') {
            await analyzeDirectory();
        }
    });

    panel.webview.html = buildDirectoryAnalysisResultHtml(data);
}

function buildDirectoryAnalysisResultHtml(data: {
    directoryPath: string;
    projectName: string;
    totalFound: number;
    processedCount: number;
    successCount: number;
    failedCount: number;
    items: FileAnalysisItem[];
}): string {
    const rowsHtml = data.items.map((item, index) => {
        if (item.success) {
            const predictionsSummary = item.apiResponse.predict.map(grp => {
                const top = grp.predictions[0];
                const topTxt = top ? `${escapeHtml(top.class)} (${(top.confidence * 100).toFixed(1)}%)` : '-';
                return `<span class="badge"><strong>${escapeHtml(grp.target)}:</strong> ${topTxt}</span>`;
            }).join(' ');

            return `
                <tr class="row-success">
                    <td>${index + 1}</td>
                    <td><code>${escapeHtml(item.file)}</code></td>
                    <td><span class="status status-ok">Sucesso</span></td>
                    <td>${predictionsSummary}</td>
                </tr>
            `;
        } else {
            return `
                <tr class="row-failure">
                    <td>${index + 1}</td>
                    <td><code>${escapeHtml(item.file)}</code></td>
                    <td><span class="status status-err">Falha</span></td>
                    <td class="err-text">${escapeHtml(item.error)}</td>
                </tr>
            `;
        }
    }).join('');

    return `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background: var(--vscode-editor-background);
                    padding: 24px;
                }
                h1 { margin-top: 0; font-size: 22px; }
                .top-bar {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 18px;
                }
                .btn {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 13px;
                    font-weight: 600;
                }
                .btn:hover {
                    background: var(--vscode-button-hoverBackground);
                }
                .summary {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
                    gap: 12px;
                    margin-bottom: 20px;
                }
                .summary-card {
                    padding: 12px 16px;
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 8px;
                    background: var(--vscode-sideBar-background);
                }
                .summary-label { font-size: 12px; opacity: 0.8; }
                .summary-value { font-size: 20px; font-weight: bold; margin-top: 4px; }
                .summary-value.success { color: var(--vscode-testing-iconPassed, #4caf50); }
                .summary-value.error { color: var(--vscode-testing-iconFailed, #f44336); }

                .meta {
                    padding: 12px 16px;
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 8px;
                    background: var(--vscode-sideBar-background);
                    margin-bottom: 20px;
                }
                .meta div { margin: 4px 0; }

                table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 13px;
                }
                th, td {
                    padding: 10px 12px;
                    text-align: left;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                th {
                    background: var(--vscode-sideBar-background);
                    font-weight: 600;
                }
                tr:hover {
                    background: var(--vscode-list-hoverBackground);
                }
                .badge {
                    display: inline-block;
                    padding: 2px 8px;
                    margin-right: 6px;
                    border-radius: 4px;
                    background: var(--vscode-badge-background);
                    color: var(--vscode-badge-foreground);
                    font-size: 12px;
                }
                .status {
                    display: inline-block;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-weight: 600;
                    font-size: 11px;
                }
                .status-ok {
                    background: rgba(76, 175, 80, 0.2);
                    color: var(--vscode-testing-iconPassed, #4caf50);
                }
                .status-err {
                    background: rgba(244, 67, 54, 0.2);
                    color: var(--vscode-testing-iconFailed, #f44336);
                }
                .err-text {
                    color: var(--vscode-testing-iconFailed, #f44336);
                    font-size: 12px;
                }
                code { word-break: break-all; }
            </style>
        </head>
        <body>
            <div class="top-bar">
                <h1>MinimapSignatures — Análise Individual de Diretório</h1>
                <button class="btn" onclick="analyzeAnother()">Analisar Outro Diretório</button>
            </div>

            <div class="meta">
                <div><strong>Diretório selecionado:</strong> <code>${escapeHtml(data.directoryPath)}</code></div>
                <div><strong>Projeto:</strong> ${escapeHtml(data.projectName)}</div>
            </div>

            <div class="summary">
                <div class="summary-card">
                    <div class="summary-label">Arquivos Encontrados</div>
                    <div class="summary-value">${data.totalFound}</div>
                </div>
                <div class="summary-card">
                    <div class="summary-label">Processados com Sucesso</div>
                    <div class="summary-value success">${data.successCount}</div>
                </div>
                <div class="summary-card">
                    <div class="summary-label">Falhas</div>
                    <div class="summary-value ${data.failedCount > 0 ? 'error' : ''}">${data.failedCount}</div>
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th style="width: 40px;">#</th>
                        <th>Arquivo</th>
                        <th style="width: 90px;">Status</th>
                        <th>Principais Previsões</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>

            <script>
                const vscode = acquireVsCodeApi();
                function analyzeAnother() {
                    vscode.postMessage({ command: 'analyzeAnother' });
                }
            </script>
        </body>
        </html>
    `;
}

async function showAverageAnalysisResult(data: {
    projectName: string;
    projectRoot: string;
    predominantExt: string;
    totalEligibleInProject: number;
    filesAggregated: number;
    readFailures: number;
    avgHash: string;
    imageBase64: string;
    apiResponse: ApiResponse;
}): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
        'sourceCodeMinimapsAverageResult',
        'Minimaps: Análise por Minimap Médio',
        vscode.ViewColumn.Beside,
        { enableScripts: false }
    );

    panel.webview.html = buildAverageAnalysisResultHtml(data);
}

function buildAverageAnalysisResultHtml(data: {
    projectName: string;
    projectRoot: string;
    predominantExt: string;
    totalEligibleInProject: number;
    filesAggregated: number;
    readFailures: number;
    avgHash: string;
    imageBase64: string;
    apiResponse: ApiResponse;
}): string {
    const groupsHtml = data.apiResponse.predict.map(group => {
        const predictionsHtml = group.predictions.map(prediction => {
            const percent = (prediction.confidence * 100).toFixed(2);
            return `
                <div class="prediction-row">
                    <span class="class-name">${escapeHtml(prediction.class)}</span>
                    <span class="confidence">${percent}%</span>
                </div>
                <div class="bar">
                    <div class="bar-fill" style="width: ${percent}%"></div>
                </div>
            `;
        }).join('');

        return `
            <section class="card">
                <h2>${escapeHtml(group.target)}</h2>
                ${predictionsHtml}
            </section>
        `;
    }).join('');

    return `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background: var(--vscode-editor-background);
                    padding: 24px;
                }
                h1 { margin-top: 0; font-size: 22px; }
                .layout {
                    display: grid;
                    grid-template-columns: 200px 1fr;
                    gap: 24px;
                    margin-bottom: 24px;
                }
                .preview-box {
                    text-align: center;
                    padding: 16px;
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 12px;
                    background: var(--vscode-sideBar-background);
                }
                .preview-img {
                    width: 128px;
                    height: 128px;
                    image-rendering: pixelated;
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    margin-top: 8px;
                }
                .meta {
                    padding: 16px;
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 12px;
                    background: var(--vscode-sideBar-background);
                }
                .meta div { margin: 6px 0; }
                .grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
                    gap: 16px;
                }
                .card {
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 12px;
                    padding: 16px;
                    background: var(--vscode-sideBar-background);
                }
                .card h2 { margin-top: 0; text-transform: capitalize; font-size: 18px; }
                .prediction-row {
                    display: flex;
                    justify-content: space-between;
                    margin-top: 12px;
                    font-size: 14px;
                }
                .class-name { font-weight: 600; }
                .confidence { opacity: 0.85; }
                .bar {
                    height: 8px;
                    border-radius: 999px;
                    background: var(--vscode-editorWidget-background);
                    overflow: hidden;
                    margin-top: 5px;
                }
                .bar-fill {
                    height: 100%;
                    background: var(--vscode-progressBar-background);
                }
                code { word-break: break-all; }
            </style>
        </head>
        <body>
            <h1>MinimapSignatures — Análise por Minimap Médio</h1>

            <div class="layout">
                <div class="preview-box">
                    <strong>Minimap Médio</strong>
                    <div><img class="preview-img" src="data:image/png;base64,${data.imageBase64}" alt="Minimap Médio" /></div>
                    <div style="font-size: 11px; opacity: 0.7; margin-top: 6px;">128 × 128 pixels</div>
                </div>

                <div class="meta">
                    <div><strong>Projeto:</strong> ${escapeHtml(data.projectName)}</div>
                    <div><strong>Caminho do Projeto:</strong> <code>${escapeHtml(data.projectRoot)}</code></div>
                    <div><strong>Extensão Predominante:</strong> <code>${escapeHtml(data.predominantExt)}</code></div>
                    <div><strong>Arquivos Agregados na Média:</strong> ${data.filesAggregated}</div>
                    <div><strong>Total de Arquivos Elegíveis no Projeto:</strong> ${data.totalEligibleInProject}</div>
                    <div><strong>MD5 da Imagem Média:</strong> <code>${escapeHtml(data.avgHash)}</code></div>
                    <div><strong>Hash retornado pela API:</strong> <code>${escapeHtml(data.apiResponse.hash)}</code></div>
                </div>
            </div>

            <div class="grid">
                ${groupsHtml}
            </div>
        </body>
        </html>
    `;
}
