import Conf from 'conf';

const config = new Conf({
  projectName: 'puter-cli',
  schema: {
    authToken: { type: 'string', default: '' },
    defaultModel: { type: 'string', default: 'gpt-5-nano' },
  }
});

export function getToken() {
  // Priority: env var > saved config
  return process.env.PUTER_TOKEN || config.get('authToken') || '';
}

export function saveToken(token) {
  config.set('authToken', token);
}

export function getDefaultModel() {
  return config.get('defaultModel');
}

export function setDefaultModel(model) {
  config.set('defaultModel', model);
}

export async function initPuter() {
  const token = getToken();
  if (!token) {
    throw new Error(
      'No auth token found.\n' +
      'Run "puter-ai auth <your-token>" to set your token, or set the PUTER_TOKEN environment variable.\n\n' +
      'To get a token:\n' +
      '  1. Go to https://puter.com and sign in/sign up\n' +
      '  2. Open DevTools Console (F12)\n' +
      '  3. Run: puter.auth.getToken()\n' +
      '  4. Copy the token'
    );
  }

  const { init } = await import('@heyputer/puter.js/src/init.cjs');
  const puter = init(token);
  return puter;
}

export { config };
