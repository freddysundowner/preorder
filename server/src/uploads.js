import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const UPLOAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
