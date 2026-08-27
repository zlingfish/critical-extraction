import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const temporaryBuild = await mkdtemp(join(tmpdir(), 'critical-extraction-build-'));

try {
  await build({
    root,
    logLevel: 'warn',
    build: {
      outDir: temporaryBuild,
      emptyOutDir: true,
      manifest: true,
      sourcemap: false,
      chunkSizeWarningLimit: 4096,
      rollupOptions: {
        output: { inlineDynamicImports: true },
      },
    },
  });

  const manifest = JSON.parse(
    await readFile(join(temporaryBuild, '.vite', 'manifest.json'), 'utf8'),
  );
  const entry = Object.values(manifest).find((item) => item.isEntry);
  if (!entry?.file) throw new Error('Missing Vite entry in build manifest');

  const [shell, javascript, ...styleParts] = await Promise.all([
    readFile(resolve(root, 'game-shell.html'), 'utf8'),
    readFile(join(temporaryBuild, entry.file), 'utf8'),
    ...(entry.css ?? []).map((file) => readFile(join(temporaryBuild, file), 'utf8')),
  ]);

  const cleanShell = shell.replace(
    /\s*<!-- launcher:start -->[\s\S]*?<!-- launcher:end -->\s*/,
    '\n',
  );
  const safeJavascript = javascript.replace(/<\/script/gi, '<\\/script');
  const output = cleanShell
    .replace('</head>', () => `    <style>\n${styleParts.join('\n')}\n    </style>\n  </head>`)
    .replace('</body>', () => `    <script type="module">\n${safeJavascript}\n    </script>\n  </body>`);

  const runtimeDirectory = '/tmp/critical-extraction-web';
  await Promise.all([
    mkdir(resolve(root, 'dist'), { recursive: true }),
    mkdir(runtimeDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(resolve(root, 'play.html'), output, 'utf8'),
    writeFile(resolve(root, 'dist/index.html'), output, 'utf8'),
    writeFile(join(runtimeDirectory, 'play.html'), output, 'utf8'),
  ]);
  console.log('Created play.html, dist/index.html, and the local preview copy');
} finally {
  await rm(temporaryBuild, { recursive: true, force: true });
}
