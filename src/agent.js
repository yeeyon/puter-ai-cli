import chalk from 'chalk';
import ora from 'ora';
import readline from 'readline';
import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { initPuter, getDefaultModel } from './auth.js';
import { TOOL_DEFINITIONS, TOOL_RISK, executeTool } from './tools.js';
import { pickModel } from './models.js';
import fs from 'fs/promises';
import path from 'path';

const marked = new Marked(markedTerminal());

export let globalRl = null;
let isAgentRunning = false;

function renderMarkdown(text) {
    try { return marked.parse(text).trimEnd(); }
    catch { return text; }
}

function extractText(response) {
    if (typeof response === 'string') return response;
    const content = response?.message?.content;
    if (content) {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            const texts = content.filter(c => c.type === 'text').map(c => c.text);
            if (texts.length > 0) return texts.join('');
        }
    }
    const str = response?.toString?.();
    if (str && str !== '[object Object]' && !str.startsWith('undefined')) return str;
    return '';
}

/**
 * Extract tool calls from a response, handling both:
 * - OpenAI: message.tool_calls = [{id, function: {name, arguments}}]
 * - Anthropic: message.content = [{type: 'tool_use', id, name, input}]
 */
function normalizeToolCalls(message) {
    const calls = [];

    // OpenAI format
    if (message?.tool_calls && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        for (const tc of message.tool_calls) {
            calls.push({
                id: tc.id,
                name: tc.function?.name || tc.name,
                args: typeof tc.function?.arguments === 'string'
                    ? JSON.parse(tc.function.arguments)
                    : (tc.function?.arguments || {}),
            });
        }
        return calls;
    }

    // Anthropic/Claude format
    if (Array.isArray(message?.content)) {
        for (const block of message.content) {
            if (block.type === 'tool_use') {
                calls.push({
                    id: block.id,
                    name: block.name,
                    args: typeof block.input === 'string'
                        ? JSON.parse(block.input)
                        : (block.input || {}),
                });
            }
        }
    }

    return calls;
}

/**
 * Convert any assistant message to OpenAI format for Puter API compatibility.
 * Puter API needs assistant.tool_calls (OpenAI style) even for Claude models.
 */
function normalizeAssistantMessage(message, toolCalls) {
    // If it already has tool_calls in OpenAI format, return as-is
    if (message?.tool_calls && Array.isArray(message.tool_calls)) {
        return message;
    }

    // If there are tool calls (extracted from Anthropic format), convert
    if (toolCalls.length > 0) {
        // Extract text content from Claude's content array
        let textContent = null;
        if (Array.isArray(message?.content)) {
            const texts = message.content.filter(c => c.type === 'text').map(c => c.text);
            textContent = texts.length > 0 ? texts.join('') : null;
        } else if (typeof message?.content === 'string') {
            textContent = message.content;
        }

        return {
            role: 'assistant',
            content: textContent,
            tool_calls: toolCalls.map(tc => ({
                id: tc.id,
                type: 'function',
                function: {
                    name: tc.name,
                    arguments: JSON.stringify(tc.args),
                }
            })),
        };
    }

    // No tool calls — normalize content to string
    if (Array.isArray(message?.content)) {
        const texts = message.content.filter(c => c.type === 'text').map(c => c.text);
        return {
            role: 'assistant',
            content: texts.join('') || '',
        };
    }

    return message;
}

// ─── Diff display ───

function generateDiff(oldContent, newContent, filePath) {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const lines = [];

    lines.push(chalk.dim(`--- a/${filePath}`));
    lines.push(chalk.dim(`+++ b/${filePath}`));

    const maxLen = Math.max(oldLines.length, newLines.length);
    let diffStart = -1, diffEnd = -1;

    for (let i = 0; i < maxLen; i++) {
        if (oldLines[i] !== newLines[i]) { diffStart = Math.max(0, i - 2); break; }
    }
    for (let i = maxLen - 1; i >= 0; i--) {
        if (oldLines[i] !== newLines[i]) { diffEnd = Math.min(maxLen, i + 3); break; }
    }

    if (diffStart === -1) return chalk.dim('  (no changes)');

    lines.push(chalk.cyan(`@@ -${diffStart + 1} +${diffStart + 1} @@`));

    for (let i = diffStart; i < Math.min(diffEnd, maxLen); i++) {
        const oldLine = i < oldLines.length ? oldLines[i] : undefined;
        const newLine = i < newLines.length ? newLines[i] : undefined;
        if (oldLine === newLine) {
            lines.push(chalk.dim(`  ${oldLine}`));
        } else {
            if (oldLine !== undefined) lines.push(chalk.red(`- ${oldLine}`));
            if (newLine !== undefined) lines.push(chalk.green(`+ ${newLine}`));
        }
    }
    return lines.join('\n');
}

// ─── Permission prompt ───

function askPermission(question) {
    return new Promise((resolve) => {
        // If main REPL is running, pause it so they don't fight for stdin
        if (globalRl) {
            globalRl.pause();
        }

        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (answer) => {
            rl.close();
            // Resume main REPL
            if (globalRl) {
                globalRl.resume();
                globalRl.prompt(true);
            }
            resolve(answer.toLowerCase().trim());
        });
    });
}

// ─── Handle a single tool call ───

async function handleToolCall(toolCall, projectDir, autoApprove) {
    try {
        const { id, name, args } = toolCall;
        const risk = TOOL_RISK[name] || 'ask';

        // Display what tool is being called
        if (name === 'run_command') {
            console.log(chalk.yellow(`\n  > ${name}: ${chalk.white(args.command || '')}`));
        } else if (name === 'write_file' || name === 'edit_file') {
            console.log(chalk.yellow(`\n  > ${name}: ${chalk.white(args.path || '')}`));
        } else if (name === 'read_file') {
            console.log(chalk.dim(`  > read_file: ${args.path || ''}`));
        } else if (name === 'list_directory') {
            console.log(chalk.dim(`  > list_directory: ${args.path || '.'}`));
        } else if (name === 'search_files') {
            console.log(chalk.dim(`  > search_files: "${args.pattern || ''}" in ${args.path || '.'}`));
        } else {
            console.log(chalk.dim(`  > ${name}`));
        }

        // Permission check for risky operations
        if (risk !== 'safe' && !autoApprove) {
            if (name === 'write_file' && args.content) {
                const filePath = path.resolve(projectDir, args.path);
                try {
                    const existing = await fs.readFile(filePath, 'utf-8');
                    console.log(generateDiff(existing, args.content, args.path));
                } catch {
                    const contentLines = args.content.split('\n');
                    const preview = contentLines.slice(0, 15).map(l => chalk.green(`+ ${l}`)).join('\n');
                    console.log(chalk.dim(`  (new file)`));
                    console.log(preview);
                    if (contentLines.length > 15) {
                        console.log(chalk.dim(`  ... (+${contentLines.length - 15} more lines)`));
                    }
                }
            }

            if (name === 'edit_file' && args.target) {
                console.log(chalk.red(`- ${args.target.split('\n').join('\n- ')}`));
                console.log(chalk.green(`+ ${(args.replacement || '').split('\n').join('\n+ ')}`));
            }

            const riskLabel = risk === 'danger' ? chalk.red('[DANGER]') : chalk.yellow('[WRITE]');
            const answer = await askPermission(`  ${riskLabel} Allow? [Y/n/skip] `);

            if (answer === 'n' || answer === 'no') return 'Operation denied by user.';
            if (answer === 'skip' || answer === 's') return 'Operation skipped by user.';
        }

        // Execute the tool
        const result = (await executeTool(name, args, projectDir)) || '(no output)';

        // Show brief output info
        if (['read_file', 'list_directory', 'search_files', 'get_project_info'].includes(name)) {
            const lineCount = result.split('\n').length;
            if (lineCount > 5) console.log(chalk.dim(`    -> ${lineCount} lines returned`));
        }

        if (name === 'run_command') {
            const rl = result.split('\n');
            const display = rl.slice(0, 20).map(l => chalk.dim(`    ${l}`)).join('\n');
            console.log(display);
            if (rl.length > 20) console.log(chalk.dim(`    ... (+${rl.length - 20} more lines)`));
        }

        if ((name === 'write_file' || name === 'edit_file') && !result.startsWith('Error')) {
            console.log(chalk.green(`    done`));
        }

        return result;
    } catch (err) {
        console.error(chalk.red(`    Tool error: ${err.message}`));
        return `Error executing tool: ${err.message}`;
    }
}

// ─── System prompt ───

function buildSystemPrompt(projectDir) {
    return `You are an expert AI coding assistant operating in an agentic mode. You have tools to read files, write files, edit files, list directories, search code, and run shell commands.

Your working directory is: ${projectDir}

Guidelines:
1. ALWAYS start by understanding the project. Use get_project_info or list_directory first if you haven't already.
2. READ files before editing them to understand the current state.
3. Use edit_file for surgical changes to existing files. Use write_file for new files or complete rewrites.
4. After making changes, consider running tests or lint to verify your work.
5. Explain what you're doing and why as you work.
6. If you encounter errors, analyze them and try to fix them.
7. Be thorough but efficient. Don't read files you don't need.

When writing code:
- Follow existing code style and conventions
- Add appropriate comments for complex logic
- Handle errors gracefully
- Maintain backward compatibility unless explicitly asked to break it`;
}

// ─── Run the agentic loop ───

async function runAgentLoop(puter, messages, modelName, projectDir, autoApprove, maxIterations = 25) {
    let iterations = 0;

    while (iterations < maxIterations) {
        iterations++;

        const spinner = ora({
            text: chalk.dim(iterations === 1 ? 'Thinking...' : `Working... (step ${iterations})`),
            spinner: 'dots',
            indent: 2,
        }).start();

        try {
            const response = await puter.ai.chat(messages, {
                model: modelName,
                tools: TOOL_DEFINITIONS,
            });
            spinner.stop();

            const message = response?.message || response;
            const toolCalls = normalizeToolCalls(message);

            // Print any text the assistant included alongside tool calls
            const textParts = extractText(response);
            if (textParts && textParts.trim() && toolCalls.length > 0) {
                console.log(chalk.cyan('\n  AI: ') + chalk.dim(textParts.trim()));
            }

            // Normalize and add assistant message to history (OpenAI format for Puter API)
            const normalizedMsg = normalizeAssistantMessage(message, toolCalls);
            if (normalizedMsg) {
                messages.push(normalizedMsg);
            }

            if (toolCalls.length > 0) {
                for (const tc of toolCalls) {
                    const result = await handleToolCall(tc, projectDir, autoApprove);

                    messages.push({
                        role: 'tool',
                        tool_call_id: tc.id,
                        content: typeof result === 'string' ? result : JSON.stringify(result),
                    });
                }
                continue;
            }

            // No tool calls — final response
            if (textParts && textParts.trim()) {
                console.log(chalk.cyan('\n  AI > ') + renderMarkdown(textParts));
                console.log();
            }

        } catch (err) {
            spinner.stop();
            const errMsg = err?.error?.message || err?.message || err?.toString?.() || JSON.stringify(err);
            // If tools already ran and this is a continuation error, show gracefully
            console.error(chalk.red(`  Error: ${errMsg}`));
            if (errMsg && (errMsg.includes('rate limit') || errMsg.includes('429'))) {
                console.log(chalk.yellow('  Waiting 5s before retrying...'));
                await new Promise(r => setTimeout(r, 5000));
                continue;
            }
            break;
        }
    }

    if (iterations >= maxIterations) {
        console.log(chalk.yellow(`\n  Warning: Reached max iterations (${maxIterations}).\n`));
    }
}

// ─── Interactive agentic mode ───

export async function startAgentMode(options = {}) {
    const puter = await initPuter();
    const projectDir = path.resolve(options.project || process.cwd());

    // Show model picker if no model explicitly set via -m flag
    let model;
    if (options.model) {
        model = options.model;
    } else {
        model = await pickModel('claude-sonnet-4.6');
    }
    console.log(chalk.green(`\n  Using: ${model}`));

    const messages = [
        { role: 'system', content: buildSystemPrompt(projectDir) }
    ];

    console.log(chalk.bold.cyan('\n  ============================================='));
    console.log(chalk.bold.white('    Puter AI - Agentic Coding Mode'));
    console.log(chalk.bold.cyan('  ============================================='));
    console.log(chalk.dim(`  Model: ${model}`));
    console.log(chalk.dim(`  Project: ${projectDir}`));
    console.log(chalk.dim(`  Auto-approve: ${options.auto ? 'ON' : 'OFF'}`));
    console.log(chalk.dim('  /help for commands, !cmd to run shell commands'));
    console.log();

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: chalk.green('  You > '),
    });
    globalRl = rl;

    let currentModel = model;

    rl.prompt();

    rl.on('line', async (line) => {
        const input = line.trim();
        if (!input) { rl.prompt(); return; }

        if (input === '/quit' || input === '/exit' || input === '/q') {
            console.log(chalk.dim('\n  Goodbye!\n'));
            process.exit(0);
        }
        if (input === '/clear') {
            messages.length = 1;
            console.log(chalk.yellow('  Conversation cleared.\n'));
            rl.prompt(); return;
        }
        if (input.startsWith('/model ')) {
            currentModel = input.slice(7).trim();
            console.log(chalk.yellow(`  Switched to model: ${currentModel}\n`));
            rl.prompt(); return;
        }
        if (input === '/auto') {
            options.auto = !options.auto;
            console.log(chalk.yellow(`  Auto-approve: ${options.auto ? 'ON' : 'OFF'}\n`));
            rl.prompt(); return;
        }
        if (input === '/help') {
            console.log(chalk.bold('\n  Commands:'));
            console.log(chalk.white('    /quit          ') + chalk.dim('Exit'));
            console.log(chalk.white('    /clear         ') + chalk.dim('Clear conversation'));
            console.log(chalk.white('    /model <name>  ') + chalk.dim('Switch AI model'));
            console.log(chalk.white('    /auto          ') + chalk.dim('Toggle auto-approve'));
            console.log(chalk.white('    /help          ') + chalk.dim('Show this help'));
            console.log(chalk.white('    !<command>     ') + chalk.dim('Run a shell command directly'));
            console.log(chalk.dim('\n  Examples:'));
            console.log(chalk.dim('    !dir                   List files (Windows)'));
            console.log(chalk.dim('    !ls -la                List files (Linux/Mac)'));
            console.log(chalk.dim('    !npm test              Run tests'));
            console.log(chalk.dim('    !git status            Check git status\n'));
            rl.prompt(); return;
        }

        // Shell escape: ! prefix runs commands directly
        if (input.startsWith('!')) {
            const cmd = input.slice(1).trim();
            if (!cmd) { rl.prompt(); return; }
            try {
                const { execSync } = await import('child_process');
                const output = execSync(cmd, {
                    cwd: projectDir,
                    encoding: 'utf-8',
                    timeout: 30000,
                    shell: true,
                    stdio: ['pipe', 'pipe', 'pipe'],
                });
                if (output.trim()) console.log(chalk.dim(output.trimEnd()));
            } catch (err) {
                const stderr = err.stderr?.trim() || '';
                const stdout = err.stdout?.trim() || '';
                if (stdout) console.log(chalk.dim(stdout));
                if (stderr) console.error(chalk.red(stderr));
                console.log(chalk.red(`  Exit code: ${err.status || 1}`));
            }
            console.log();
            rl.prompt(); return;
        }

        if (isAgentRunning) return;

        messages.push({ role: 'user', content: input });
        isAgentRunning = true;
        try {
            await runAgentLoop(puter, messages, currentModel, projectDir, options.auto);
        } finally {
            isAgentRunning = false;
            rl.prompt();
        }
    });

    rl.on('close', () => process.exit(0));
}

// ─── One-shot agentic command ───

export async function agentCommand(prompt, options = {}) {
    const puter = await initPuter();
    const model = options.model || 'claude-sonnet-4.6';
    const projectDir = path.resolve(options.project || process.cwd());

    console.log(chalk.dim(`\n  Model: ${model}`));
    console.log(chalk.dim(`  Project: ${projectDir}\n`));

    const messages = [
        { role: 'system', content: buildSystemPrompt(projectDir) },
        { role: 'user', content: prompt },
    ];

    await runAgentLoop(puter, messages, model, projectDir, options.auto);
}
