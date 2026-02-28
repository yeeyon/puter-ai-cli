#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { saveToken, getToken, setDefaultModel, getDefaultModel } from './auth.js';
import { singleChat, interactiveChat } from './chat.js';
import { formatModelsTable } from './models.js';
import { startAgentMode, agentCommand } from './agent.js';

const program = new Command();

program
    .name('puter-ai')
    .description(chalk.cyan('🚀 Puter AI CLI') + ' — Agentic coding assistant powered by 500+ free AI models')
    .version('2.0.0');

// ─── Default command: chat ───
program
    .command('chat')
    .description('Send a prompt to an AI model')
    .argument('<prompt>', 'The prompt to send')
    .option('-m, --model <model>', 'AI model to use')
    .option('-s, --stream', 'Stream the response in real-time')
    .option('-t, --temperature <number>', 'Temperature (0-2)')
    .option('--max-tokens <number>', 'Maximum tokens to generate')
    .option('--system <message>', 'System prompt')
    .action(async (prompt, opts) => {
        try {
            await singleChat(prompt, opts);
        } catch (err) {
            console.error(chalk.red(`\n  Error: ${err.message}\n`));
            process.exit(1);
        }
    });

// ─── Interactive mode ───
program
    .command('interactive')
    .aliases(['i', 'repl'])
    .description('Start an interactive multi-turn chat session')
    .option('-m, --model <model>', 'AI model to use')
    .option('-s, --stream', 'Enable streaming by default')
    .option('--system <message>', 'System prompt')
    .action(async (opts) => {
        try {
            await interactiveChat(opts);
        } catch (err) {
            console.error(chalk.red(`\n  Error: ${err.message}\n`));
            process.exit(1);
        }
    });

// ─── Auth command ───
program
    .command('auth')
    .description('Set your Puter auth token')
    .argument('[token]', 'Your Puter auth token')
    .action((token) => {
        if (token) {
            saveToken(token);
            console.log(chalk.green('\n  ✓ Auth token saved successfully!\n'));
        } else {
            const current = getToken();
            if (current) {
                console.log(chalk.green('\n  ✓ Auth token is configured'));
                console.log(chalk.dim(`    Token: ${current.slice(0, 8)}...${current.slice(-4)}\n`));
            } else {
                console.log(chalk.yellow('\n  ⚠ No auth token configured.'));
                console.log(chalk.dim('  To set your token:\n'));
                console.log(chalk.white('    puter-ai auth <your-token>\n'));
                console.log(chalk.dim('  To get a token:'));
                console.log(chalk.dim('    1. Go to https://puter.com and sign in'));
                console.log(chalk.dim('    2. Open DevTools Console (F12)'));
                console.log(chalk.dim('    3. Run: puter.auth.getToken()'));
                console.log(chalk.dim('    4. Copy the token\n'));
            }
        }
    });

// ─── Models command ───
program
    .command('models')
    .description('List popular available AI models')
    .action(() => {
        console.log(chalk.bold.cyan('\n  ╔══════════════════════════════════════════╗'));
        console.log(chalk.bold.cyan('  ║') + chalk.bold.white('   Available AI Models (Popular Picks)    ') + chalk.bold.cyan('║'));
        console.log(chalk.bold.cyan('  ╚══════════════════════════════════════════╝'));
        console.log(formatModelsTable());
        console.log(chalk.dim('\n  500+ models available. Use any model ID with: puter-ai chat "prompt" -m <model-id>'));
        console.log(chalk.dim('  Full list: https://developer.puter.com/ai/models/\n'));
    });

// ─── Set default model ───
program
    .command('set-model')
    .description('Set the default AI model')
    .argument('<model>', 'Model ID to set as default')
    .action((model) => {
        setDefaultModel(model);
        console.log(chalk.green(`\n  ✓ Default model set to: ${model}\n`));
    });

// ─── Agentic coding mode (interactive) ───
program
    .command('code')
    .aliases(['agent', 'c'])
    .description('Start agentic coding mode — AI reads, writes, and runs code')
    .option('-m, --model <model>', 'AI model to use (skips picker)')
    .option('-p, --project <dir>', 'Project directory (default: cwd)')
    .option('-a, --auto', 'Auto-approve safe file operations')
    .action(async (opts) => {
        try {
            await startAgentMode(opts);
        } catch (err) {
            console.error(chalk.red(`\n  Error: ${err.message}\n`));
            process.exit(1);
        }
    });

// ─── One-shot agentic command ───
program
    .command('do')
    .description('Execute a one-shot agentic task (e.g. "fix the failing tests")')
    .argument('<prompt>', 'What to do')
    .option('-m, --model <model>', 'AI model to use', 'claude-sonnet-4.6')
    .option('-p, --project <dir>', 'Project directory (default: cwd)')
    .option('-a, --auto', 'Auto-approve safe file operations')
    .action(async (prompt, opts) => {
        try {
            await agentCommand(prompt, opts);
        } catch (err) {
            console.error(chalk.red(`\n  Error: ${err.message}\n`));
            process.exit(1);
        }
    });

// ─── Default: show help if no command ───
program.addHelpText('after', `
${chalk.dim('  Examples:')}
    ${chalk.white('puter-ai code')}                    ${chalk.dim('Start agentic coding assistant')}
    ${chalk.white('puter-ai do "add error handling"')} ${chalk.dim('One-shot agentic task')}
    ${chalk.white('puter-ai chat "Hello!"')}           ${chalk.dim('Quick AI query')}
    ${chalk.white('puter-ai chat "Hi" --stream')}      ${chalk.dim('Stream the response')}
    ${chalk.white('puter-ai interactive')}             ${chalk.dim('Multi-turn chat')}
    ${chalk.white('puter-ai models')}                  ${chalk.dim('List available models')}
    ${chalk.white('puter-ai auth <token>')}            ${chalk.dim('Set auth token')}
`);

program.parse();
