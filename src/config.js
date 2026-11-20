import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export async function loadConfig(path) {
  const explicit = path !== undefined;
  if (explicit && (typeof path !== 'string' || !path)) throw new TypeError('Config path must be a non-empty string.');
  path ??= join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'portlense', 'config.json');
  let config;
  try { config = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (!explicit && error.code === 'ENOENT') return {}; throw new Error(`Cannot load config ${path}: ${error.message}`); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Config must be a JSON object.');
  const validators = {
    color: v => ['auto', 'always', 'never'].includes(v),
    sort: v => ['port', 'protocol', 'pid', 'process', 'state'].includes(v),
    interval: v => typeof v === 'number' && Number.isFinite(v) && v >= 0.1 && v <= 86400,
    protocol: v => typeof v === 'string' && ['tcp', 'udp'].includes(v.toLowerCase()),
    all: v => typeof v === 'boolean', details: v => typeof v === 'boolean',
  };
  for (const [key, value] of Object.entries(config)) if (!validators[key] || !validators[key](value)) throw new Error(`Invalid config option: ${key}`);
  return config;
}

