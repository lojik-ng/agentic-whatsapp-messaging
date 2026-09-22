#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '../dist/cli/index.js');
const srcPath = path.resolve(__dirname, '../src/cli/index.js');

const cliPath = fs.existsSync(distPath) ? distPath : srcPath;
const { runCli } = await import(pathToFileURL(cliPath).href);

runCli().catch((err) => {
  console.error(err);
  process.exit(1);
});
