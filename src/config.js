// Loads project configuration from .env and config.json.
// Exports loadConfig() which returns { repoRoot, workspacePath, msdsLibraryPath,
// referencePath, projectsPath, anthropicApiKey }. Throws with a helpful
// message if anything required is missing.

const fs = require('node:fs');
const path = require('node:path');

// __dirname is Node's built-in for "the directory of the currently running file."
// This file lives at src/config.js, so repoRoot = one level up.
const repoRoot = path.join(__dirname, '..');

// Tiny .env parser. Format: one KEY=VALUE per line, # for comments, blank lines ignored.
// We write this ourselves instead of installing the `dotenv` package — it's 12 lines
// and avoids an extra dependency for something trivial.
function loadEnv() {
  const envPath = path.join(repoRoot, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    // Don't overwrite a variable that's already in the shell environment —
    // lets you override .env for one-off runs without editing the file.
    if (!process.env[key]) process.env[key] = value;
  }
}

function loadConfig() {
  loadEnv();

  const configPath = path.join(repoRoot, 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Missing config.json at ${configPath}\n` +
      `  Fix: copy config.example.json to config.json and set "workspacePath".`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error(`config.json is not valid JSON: ${err.message}`);
  }

  if (!parsed.workspacePath) {
    throw new Error('config.json is missing required field "workspacePath".');
  }

  // path.normalize converts forward/back slashes to whatever the OS expects.
  // config.example.json uses forward slashes so Windows users don't have to
  // double-escape backslashes in JSON.
  const workspacePath = path.normalize(parsed.workspacePath);

  if (!fs.existsSync(workspacePath)) {
    throw new Error(
      `workspacePath does not exist: ${workspacePath}\n` +
      `  Fix: check the path in config.json is correct.`
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      `Missing ANTHROPIC_API_KEY\n` +
      `  Fix: copy .env.example to .env and paste your Claude API key.`
    );
  }

  return {
    repoRoot,
    workspacePath,
    msdsLibraryPath: path.join(workspacePath, 'MSDS Library'),
    referencePath: path.join(workspacePath, 'Reference'),
    projectsPath: path.join(repoRoot, 'Projects'),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  };
}

module.exports = { loadConfig };
