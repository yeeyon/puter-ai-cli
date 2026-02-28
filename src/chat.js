import chalk from 'chalk';
import ora from 'ora';
import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import readline from 'readline';
import { initPuter, getDefaultModel } from './auth.js';

const marked = new Marked(markedTerminal());

function renderMarkdown(text) {
    try {
        return marked.parse(text).trimEnd();
    } catch {
        return text;
    }
}

/**
 * Extract text from various response formats.
 * Handles: string, {message:{content: string|array}}, toString, etc.
 */
function extractText(response) {
    if (typeof response === 'string') {
        return response;
    }

    // Handle .message.content (could be string or array)
    const content = response?.message?.content;
    if (content) {
        if (typeof content === 'string') {
            return content;
        }
        // Anthropic-style: [{type:'text', text:'...'}]
        if (Array.isArray(content)) {
            return content
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('');
        }
    }

    // Fallback: toString if it gives something meaningful
    const str = response?.toString?.();
    if (str && str !== '[object Object]') {
        return str;
    }

    return JSON.stringify(response, null, 2);
}

/**
 * Single-shot chat: send a prompt, get a response
 */
export async function singleChat(prompt, options = {}) {
    const puter = await initPuter();
    const model = options.model || getDefaultModel();

    const chatOptions = { model };
    if (options.stream) chatOptions.stream = true;
    if (options.temperature != null) chatOptions.temperature = parseFloat(options.temperature);
    if (options.maxTokens != null) chatOptions.max_tokens = parseInt(options.maxTokens);

    // Build messages array if system prompt is provided
    let input;
    if (options.system) {
        input = [
            { role: 'system', content: options.system },
            { role: 'user', content: prompt },
        ];
    } else {
        input = prompt;
    }

    console.log(chalk.dim(`\n  Model: ${model}\n`));

    if (options.stream) {
        // Streaming mode
        const response = await puter.ai.chat(input, chatOptions);
        let fullText = '';
        process.stdout.write(chalk.cyan('  '));
        for await (const chunk of response) {
            const text = chunk?.text || '';
            process.stdout.write(text);
            fullText += text;
        }
        console.log('\n');
    } else {
        // Non-streaming mode with spinner
        const spinner = ora({
            text: chalk.dim('Thinking...'),
            spinner: 'dots',
            indent: 2,
        }).start();

        try {
            const response = await puter.ai.chat(input, chatOptions);
            spinner.stop();

            const text = extractText(response);

            console.log(renderMarkdown(text));
            console.log();
        } catch (err) {
            spinner.fail(chalk.red('Error'));
            throw err;
        }
    }
}

/**
 * Interactive chat mode: multi-turn REPL with conversation history
 */
export async function interactiveChat(options = {}) {
    const puter = await initPuter();
    const model = options.model || getDefaultModel();
    const messages = [];

    if (options.system) {
        messages.push({ role: 'system', content: options.system });
    }

    console.log(chalk.bold.cyan('\n  ╔══════════════════════════════════════╗'));
    console.log(chalk.bold.cyan('  ║') + chalk.bold.white('   Puter AI — Interactive Chat Mode   ') + chalk.bold.cyan('║'));
    console.log(chalk.bold.cyan('  ╚══════════════════════════════════════╝'));
    console.log(chalk.dim(`  Model: ${model}`));
    console.log(chalk.dim('  Type your message and press Enter. Commands:'));
    console.log(chalk.dim('    /quit     — exit'));
    console.log(chalk.dim('    /clear    — clear conversation history'));
    console.log(chalk.dim('    /model <m> — switch model'));
    console.log(chalk.dim('    /stream   — toggle streaming mode'));
    console.log();

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: chalk.green('  You › '),
    });

    let currentModel = model;
    let streamMode = options.stream || false;

    rl.prompt();

    rl.on('line', async (line) => {
        const input = line.trim();
        if (!input) {
            rl.prompt();
            return;
        }

        // Handle commands
        if (input === '/quit' || input === '/exit' || input === '/q') {
            console.log(chalk.dim('\n  Goodbye! 👋\n'));
            rl.close();
            process.exit(0);
        }

        if (input === '/clear') {
            messages.length = 0;
            if (options.system) {
                messages.push({ role: 'system', content: options.system });
            }
            console.log(chalk.yellow('  ↻ Conversation cleared.\n'));
            rl.prompt();
            return;
        }

        if (input.startsWith('/model ')) {
            currentModel = input.slice(7).trim();
            console.log(chalk.yellow(`  ↻ Switched to model: ${currentModel}\n`));
            rl.prompt();
            return;
        }

        if (input === '/stream') {
            streamMode = !streamMode;
            console.log(chalk.yellow(`  ↻ Streaming: ${streamMode ? 'ON' : 'OFF'}\n`));
            rl.prompt();
            return;
        }

        // Add user message to history
        messages.push({ role: 'user', content: input });

        const chatOptions = { model: currentModel };
        if (streamMode) chatOptions.stream = true;

        try {
            if (streamMode) {
                const response = await puter.ai.chat(messages, chatOptions);
                let fullText = '';
                process.stdout.write(chalk.cyan('\n  AI › '));
                for await (const chunk of response) {
                    const text = chunk?.text || '';
                    process.stdout.write(text);
                    fullText += text;
                }
                console.log('\n');
                messages.push({ role: 'assistant', content: fullText });
            } else {
                const spinner = ora({
                    text: chalk.dim('Thinking...'),
                    spinner: 'dots',
                    indent: 2,
                }).start();

                const response = await puter.ai.chat(messages, chatOptions);
                spinner.stop();

                const text = extractText(response);

                console.log(chalk.cyan('\n  AI › ') + renderMarkdown(text));
                console.log();
                messages.push({ role: 'assistant', content: text });
            }
        } catch (err) {
            console.error(chalk.red(`\n  Error: ${err.message}\n`));
        }

        rl.prompt();
    });

    rl.on('close', () => {
        process.exit(0);
    });
}
