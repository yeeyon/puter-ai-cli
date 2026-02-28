import chalk from 'chalk';
import readline from 'readline';

export const POPULAR_MODELS = [
    // OpenAI
    { id: 'gpt-5-nano', vendor: 'OpenAI', description: 'GPT-5 Nano — fast & lightweight' },
    { id: 'gpt-5-mini', vendor: 'OpenAI', description: 'GPT-5 Mini — balanced' },
    { id: 'gpt-5', vendor: 'OpenAI', description: 'GPT-5 — flagship' },
    { id: 'gpt-5-pro', vendor: 'OpenAI', description: 'GPT-5 Pro — highest capability' },
    { id: 'gpt-4o', vendor: 'OpenAI', description: 'GPT-4o — multimodal' },
    { id: 'o3', vendor: 'OpenAI', description: 'o3 — advanced reasoning' },
    { id: 'o4-mini', vendor: 'OpenAI', description: 'o4 Mini — fast reasoning' },

    // Anthropic
    { id: 'claude-opus-4.6', vendor: 'Anthropic', description: 'Claude Opus 4.6 — most capable' },
    { id: 'claude-sonnet-4.6', vendor: 'Anthropic', description: 'Claude Sonnet 4.6 — balanced power' },
    { id: 'claude-opus-4.5', vendor: 'Anthropic', description: 'Claude Opus 4.5 — flagship' },
    { id: 'claude-sonnet-4.5', vendor: 'Anthropic', description: 'Claude Sonnet 4.5 — enhanced' },
    { id: 'claude-sonnet-4', vendor: 'Anthropic', description: 'Claude Sonnet 4 — reliable' },
    { id: 'claude-opus-4', vendor: 'Anthropic', description: 'Claude Opus 4 — capable' },
    { id: 'claude-haiku-4.5', vendor: 'Anthropic', description: 'Claude Haiku 4.5 — fast & cheap' },

    // Google
    { id: 'gemini-2.5-flash', vendor: 'Google', description: 'Gemini 2.5 Flash — fast' },
    { id: 'gemini-2.5-pro', vendor: 'Google', description: 'Gemini 2.5 Pro — advanced' },
    { id: 'gemini-3-flash', vendor: 'Google', description: 'Gemini 3 Flash — next-gen fast' },
    { id: 'gemini-3-pro', vendor: 'Google', description: 'Gemini 3 Pro — next-gen pro' },

    // xAI
    { id: 'grok-4', vendor: 'xAI', description: 'Grok 4 — latest flagship' },
    { id: 'grok-3', vendor: 'xAI', description: 'Grok 3 — reasoning' },
    { id: 'grok-3-mini', vendor: 'xAI', description: 'Grok 3 Mini — compact' },

    // DeepSeek
    { id: 'deepseek-r1', vendor: 'DeepSeek', description: 'DeepSeek R1 — reasoning' },
    { id: 'deepseek-chat', vendor: 'DeepSeek', description: 'DeepSeek Chat — general' },

    // Mistral
    { id: 'mistral-medium-3', vendor: 'Mistral', description: 'Mistral Medium 3 — balanced' },
    { id: 'mistral-small-3', vendor: 'Mistral', description: 'Mistral Small 3 — efficient' },

    // Meta
    { id: 'meta-llama/llama-4-maverick', vendor: 'Meta', description: 'Llama 4 Maverick' },
    { id: 'meta-llama/llama-4-scout', vendor: 'Meta', description: 'Llama 4 Scout' },

    // Qwen
    { id: 'qwen-max', vendor: 'Alibaba', description: 'Qwen Max — most capable' },
    { id: 'qwen-plus', vendor: 'Alibaba', description: 'Qwen Plus — balanced' },
];

// Recommended models for agentic coding (good at tool use)
export const RECOMMENDED_AGENT_MODELS = [
    { id: 'claude-opus-4.6', label: 'Claude Opus 4.6', desc: 'Most capable — best for complex tasks' },
    { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6', desc: 'Balanced — great tool use, faster' },
    { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5', desc: 'Enhanced Sonnet' },
    { id: 'claude-sonnet-4', label: 'Claude Sonnet 4', desc: 'Reliable, well-tested' },
    { id: 'gpt-5', label: 'GPT-5', desc: 'OpenAI flagship' },
    { id: 'gpt-5-mini', label: 'GPT-5 Mini', desc: 'Fast OpenAI' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', desc: 'Google advanced' },
    { id: 'grok-4', label: 'Grok 4', desc: 'xAI flagship' },
    { id: 'deepseek-r1', label: 'DeepSeek R1', desc: 'Reasoning model' },
];

export function formatModelsTable() {
    let currentVendor = '';
    const lines = [];

    for (const m of POPULAR_MODELS) {
        if (m.vendor !== currentVendor) {
            currentVendor = m.vendor;
            lines.push('');
            lines.push(chalk.bold(`  -- ${currentVendor} --`));
        }
        lines.push(`    ${chalk.white(m.id.padEnd(38))} ${chalk.dim(m.description)}`);
    }

    return lines.join('\n');
}

/**
 * Interactive model picker — shows a numbered list and lets user choose
 */
export function pickModel(defaultModel = 'claude-sonnet-4.6') {
    return new Promise((resolve) => {
        const models = RECOMMENDED_AGENT_MODELS;

        console.log(chalk.bold.cyan('\n  Select a model:\n'));

        for (let i = 0; i < models.length; i++) {
            const marker = models[i].id === defaultModel ? chalk.green(' *') : '  ';
            const num = chalk.cyan(`  [${i + 1}]`);
            const label = chalk.white(models[i].label.padEnd(22));
            const desc = chalk.dim(models[i].desc);
            console.log(`${marker}${num} ${label} ${desc}`);
        }

        console.log(chalk.dim(`\n  Or type a custom model ID (e.g. "qwen-max")`));
        console.log(chalk.dim(`  Press Enter for default: ${defaultModel}\n`));

        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(chalk.green('  Model > '), (answer) => {
            rl.close();
            const input = answer.trim();

            if (!input) {
                resolve(defaultModel);
                return;
            }

            // Check if it's a number
            const num = parseInt(input);
            if (num >= 1 && num <= models.length) {
                resolve(models[num - 1].id);
                return;
            }

            // Custom model ID (basic validation: models don't have spaces and aren't full sentences)
            if (input.includes(' ') || input.length > 50) {
                console.log(chalk.red('\n  Invalid model ID. Using default.'));
                resolve(defaultModel);
                return;
            }

            resolve(input);
        });
    });
}
