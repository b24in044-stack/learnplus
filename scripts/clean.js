import { rm } from 'node:fs/promises';
import path from 'node:path';

const generatedDirectory = path.resolve(process.cwd(), 'dist');
const expectedDirectory = path.join(process.cwd(), 'dist');

if (generatedDirectory !== expectedDirectory) {
  throw new Error('Refusing to clean an unexpected directory.');
}

await rm(generatedDirectory, { recursive: true, force: true });
console.log('Removed generated dist directory.');
