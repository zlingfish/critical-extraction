import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'preview');
const output = resolve(root, 'dist');
const runtimeDirectory = '/tmp/critical-extraction-web';

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });

// Keep every delivery surface on the same build. The local preview server and
// the public GitHub Pages package must never point at an older standalone file.
await mkdir(runtimeDirectory, { recursive: true });
await Promise.all([
  cp(resolve(source, 'play.html'), resolve(root, 'play.html')),
  cp(resolve(source, 'play.html'), resolve(runtimeDirectory, 'play.html')),
]);

console.log('已同步 preview、根目录、dist 和本地公网预览目录的最新版网页。');
