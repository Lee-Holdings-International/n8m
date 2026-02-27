#!/usr/bin/env node --loader ts-node/esm --no-warnings=ExperimentalWarning

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

// Load .env from the package root regardless of the user's cwd
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import {execute} from '@oclif/core'

await execute({development: true, dir: import.meta.url})
