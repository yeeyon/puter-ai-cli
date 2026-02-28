import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { glob } from 'fs/promises';

/**
 * Tool definitions (JSON Schema format for Puter.js function calling)
 */
export const TOOL_DEFINITIONS = [
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read the contents of a file at the given path. Use this to understand existing code before making changes.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Absolute or relative file path to read'
                    }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'write_file',
            description: 'Create or overwrite a file with the given content. Use this to create new files or completely replace existing ones.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'File path to write to'
                    },
                    content: {
                        type: 'string',
                        description: 'The full content to write to the file'
                    }
                },
                required: ['path', 'content']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'edit_file',
            description: 'Edit a file by replacing a specific target string with new content. Use this for surgical edits to existing files instead of rewriting the whole file.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'File path to edit'
                    },
                    target: {
                        type: 'string',
                        description: 'The exact string to find and replace (must match exactly)'
                    },
                    replacement: {
                        type: 'string',
                        description: 'The replacement string'
                    }
                },
                required: ['path', 'target', 'replacement']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_directory',
            description: 'List all files and directories in a path. Returns names with type indicators (/ for dirs). Use this to understand project structure.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Directory path to list (default: current directory)'
                    },
                    recursive: {
                        type: 'boolean',
                        description: 'If true, list recursively (max 3 levels deep). Default: false'
                    }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_files',
            description: 'Search for a text pattern across files in the project. Returns matching lines with file paths and line numbers. Like grep.',
            parameters: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: 'Text or regex pattern to search for'
                    },
                    path: {
                        type: 'string',
                        description: 'Directory to search in (default: current directory)'
                    },
                    file_pattern: {
                        type: 'string',
                        description: 'Optional glob pattern to filter files, e.g. "*.js" or "*.py"'
                    }
                },
                required: ['pattern']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'run_command',
            description: 'Execute a shell command and return its output. Use this to run tests, install packages, check status, etc. Commands run in the project directory.',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'The shell command to execute'
                    }
                },
                required: ['command']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_project_info',
            description: 'Get information about the current project: directory structure, package.json, git status, etc. Call this first to understand the project.',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    }
];

// ─── Risk levels ───
export const TOOL_RISK = {
    read_file: 'safe',
    list_directory: 'safe',
    search_files: 'safe',
    get_project_info: 'safe',
    write_file: 'ask',
    edit_file: 'ask',
    run_command: 'danger',
};

// ─── Tool implementations ───

async function readFileImpl(args, projectDir) {
    const filePath = path.resolve(projectDir, args.path);
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        if (lines.length > 500) {
            return `[${lines.length} lines — showing first 500]\n${lines.slice(0, 500).join('\n')}\n\n... (truncated, ${lines.length - 500} more lines)`;
        }
        return `[${lines.length} lines]\n${content}`;
    } catch (err) {
        return `Error reading file: ${err.message}`;
    }
}

async function writeFileImpl(args, projectDir) {
    const filePath = path.resolve(projectDir, args.path);
    try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, args.content, 'utf-8');
        return `File written successfully: ${filePath}`;
    } catch (err) {
        return `Error writing file: ${err.message}`;
    }
}

async function editFileImpl(args, projectDir) {
    const filePath = path.resolve(projectDir, args.path);
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        if (!content.includes(args.target)) {
            return `Error: Target string not found in ${args.path}. Make sure it matches exactly.`;
        }
        const newContent = content.replace(args.target, args.replacement);
        await fs.writeFile(filePath, newContent, 'utf-8');
        return `File edited successfully: ${filePath}`;
    } catch (err) {
        return `Error editing file: ${err.message}`;
    }
}

async function listDirectoryImpl(args, projectDir) {
    const dirPath = path.resolve(projectDir, args.path || '.');
    const maxDepth = args.recursive ? 3 : 1;
    const maxEntries = 200;
    let entryCount = 0;

    const SKIP_DIRS = new Set([
        'node_modules', '.git', '__pycache__', '.next', 'dist', '.cache',
        '.gemini', '.vscode', '.idea', 'AppData', 'Application Data',
        'Local Settings', 'Desktop', 'Documents', 'Downloads', 'Music',
        'Pictures', 'Videos', 'OneDrive', 'Contacts', 'Favorites',
        'Links', 'Saved Games', 'Searches', 'PrintHood', 'Recent',
        'SendTo', 'Templates', 'NetHood', 'ntuser.dat', 'NTUSER.DAT',
        'coverage', '.nyc_output', '.angular', '.npm', '.yarn',
        '.nuget', '.dotnet', '.cargo', 'vendor', 'target',
    ]);

    async function listDir(dir, depth, prefix = '') {
        const results = [];
        if (depth > maxDepth || entryCount >= maxEntries) return results;

        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            const sorted = entries.sort((a, b) => {
                if (a.isDirectory() && !b.isDirectory()) return -1;
                if (!a.isDirectory() && b.isDirectory()) return 1;
                return a.name.localeCompare(b.name);
            });

            for (const entry of sorted) {
                if (entryCount >= maxEntries) {
                    results.push(`${prefix}... (capped at ${maxEntries} entries)`);
                    break;
                }

                if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('ntuser')) {
                    results.push(`${prefix}${entry.name}/ [skipped]`);
                    entryCount++;
                    continue;
                }

                if (entry.isDirectory()) {
                    results.push(`${prefix}${entry.name}/`);
                    entryCount++;
                    if (args.recursive) {
                        const sub = await listDir(path.join(dir, entry.name), depth + 1, prefix + '  ');
                        results.push(...sub);
                    }
                } else {
                    try {
                        const stat = await fs.stat(path.join(dir, entry.name));
                        const size = stat.size < 1024 ? `${stat.size}B` :
                            stat.size < 1048576 ? `${(stat.size / 1024).toFixed(1)}KB` :
                                `${(stat.size / 1048576).toFixed(1)}MB`;
                        results.push(`${prefix}${entry.name} (${size})`);
                    } catch {
                        results.push(`${prefix}${entry.name}`);
                    }
                    entryCount++;
                }
            }
        } catch (err) {
            results.push(`${prefix}[Error: ${err.message}]`);
        }
        return results;
    }

    const items = await listDir(dirPath, 1);
    return items.join('\n') || '(empty directory)';
}

async function searchFilesImpl(args, projectDir) {
    const searchDir = path.resolve(projectDir, args.path || '.');
    const results = [];
    const maxResults = 30;

    async function searchInFile(filePath) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(args.pattern)) {
                    const relPath = path.relative(projectDir, filePath);
                    results.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
                    if (results.length >= maxResults) return;
                }
            }
        } catch { /* skip binary/unreadable files */ }
    }

    async function walkDir(dir, depth = 0) {
        if (depth > 5 || results.length >= maxResults) return;
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (results.length >= maxResults) return;
                if (['node_modules', '.git', '__pycache__', '.next', 'dist'].includes(entry.name)) continue;

                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await walkDir(fullPath, depth + 1);
                } else {
                    // Filter by file_pattern if specified
                    if (args.file_pattern) {
                        const ext = path.extname(entry.name);
                        const pattern = args.file_pattern.replace('*', '');
                        if (!entry.name.endsWith(pattern) && ext !== pattern) continue;
                    }
                    await searchInFile(fullPath);
                }
            }
        } catch { /* skip */ }
    }

    await walkDir(searchDir);
    return results.length > 0
        ? results.join('\n') + (results.length >= maxResults ? `\n... (capped at ${maxResults} results)` : '')
        : 'No matches found.';
}

function runCommandImpl(args, projectDir) {
    try {
        const output = execSync(args.command, {
            cwd: projectDir,
            encoding: 'utf-8',
            timeout: 30000,
            maxBuffer: 1024 * 1024,
            shell: true,
        });
        return output || '(command completed with no output)';
    } catch (err) {
        const stderr = err.stderr || '';
        const stdout = err.stdout || '';
        return `Command exited with code ${err.status || 1}\n${stdout}\n${stderr}`.trim();
    }
}

async function getProjectInfoImpl(args, projectDir) {
    const info = [`Project directory: ${projectDir}\n`];

    // Directory listing
    info.push('── Directory Structure ──');
    const tree = await listDirectoryImpl({ path: '.', recursive: true }, projectDir);
    info.push(tree);

    // Check for package.json
    try {
        const pkg = JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf-8'));
        info.push('\n── package.json ──');
        info.push(`Name: ${pkg.name || 'N/A'}`);
        info.push(`Version: ${pkg.version || 'N/A'}`);
        if (pkg.description) info.push(`Description: ${pkg.description}`);
        if (pkg.scripts) info.push(`Scripts: ${Object.keys(pkg.scripts).join(', ')}`);
        if (pkg.dependencies) info.push(`Dependencies: ${Object.keys(pkg.dependencies).join(', ')}`);
        if (pkg.devDependencies) info.push(`Dev Dependencies: ${Object.keys(pkg.devDependencies).join(', ')}`);
    } catch { /* no package.json */ }

    // Check for common config files
    const configFiles = ['tsconfig.json', '.eslintrc.json', 'vite.config.js', 'next.config.js',
        'webpack.config.js', 'Cargo.toml', 'pyproject.toml', 'requirements.txt', 'go.mod',
        'Makefile', 'Dockerfile', '.env.example'];
    const found = [];
    for (const cfg of configFiles) {
        try {
            await fs.access(path.join(projectDir, cfg));
            found.push(cfg);
        } catch { /* not found */ }
    }
    if (found.length > 0) {
        info.push(`\n── Config Files ──\n${found.join(', ')}`);
    }

    // Git status
    try {
        const branch = execSync('git branch --show-current', { cwd: projectDir, encoding: 'utf-8' }).trim();
        const status = execSync('git status --short', { cwd: projectDir, encoding: 'utf-8' }).trim();
        info.push(`\n── Git ──\nBranch: ${branch}`);
        if (status) info.push(`Changes:\n${status}`);
        else info.push('Working tree clean');
    } catch { /* not a git repo */ }

    return info.join('\n');
}

// ─── Tool executor ───

export async function executeTool(name, args, projectDir) {
    switch (name) {
        case 'read_file': return readFileImpl(args, projectDir);
        case 'write_file': return writeFileImpl(args, projectDir);
        case 'edit_file': return editFileImpl(args, projectDir);
        case 'list_directory': return listDirectoryImpl(args, projectDir);
        case 'search_files': return searchFilesImpl(args, projectDir);
        case 'run_command': return runCommandImpl(args, projectDir);
        case 'get_project_info': return getProjectInfoImpl(args, projectDir);
        default: return `Unknown tool: ${name}`;
    }
}
