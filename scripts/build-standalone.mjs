import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';

const workspaceRoot = resolve(import.meta.dirname, '..');
const root = process.env.CRITICAL_EXTRACTION_SOURCE_ROOT
  ? resolve(process.env.CRITICAL_EXTRACTION_SOURCE_ROOT)
  : workspaceRoot;
const outputRoot = process.env.CRITICAL_EXTRACTION_OUTPUT_ROOT
  ? resolve(process.env.CRITICAL_EXTRACTION_OUTPUT_ROOT)
  : root;
const temporaryBuild = await mkdtemp(join(tmpdir(), 'critical-extraction-build-'));

try {
  await build({
    root: workspaceRoot,
    logLevel: 'warn',
    resolve: {
      alias: root === workspaceRoot ? [] : [{ find: /^\/src/, replacement: resolve(root, 'src') }],
    },
    build: {
      outDir: temporaryBuild,
      emptyOutDir: true,
      manifest: true,
      sourcemap: false,
      chunkSizeWarningLimit: 4096,
      rollupOptions: {
        input: resolve(workspaceRoot, 'game-shell.html'),
        output: { inlineDynamicImports: true },
      },
    },
  });

  const manifest = JSON.parse(
    await readFile(join(temporaryBuild, '.vite', 'manifest.json'), 'utf8'),
  );
  const entry = Object.values(manifest).find((item) => item.isEntry);
  if (!entry?.file) throw new Error('Missing Vite entry in build manifest');

  const [shell, javascript, noBossMode, ...styleParts] = await Promise.all([
    readFile(resolve(workspaceRoot, 'game-shell.html'), 'utf8'),
    readFile(join(temporaryBuild, entry.file), 'utf8'),
    readFile(resolve(workspaceRoot, 'no-boss-mode.js'), 'utf8'),
    ...(entry.css ?? []).map((file) => readFile(join(temporaryBuild, file), 'utf8')),
  ]);

  const cleanShell = shell.replace(
    /\s*<!-- launcher:start -->[\s\S]*?<!-- launcher:end -->\s*/,
    '\n',
  ).replace(
    /\s*<!-- build-entry:start -->[\s\S]*?<!-- build-entry:end -->\s*/,
    '\n',
  );
  const safeJavascript = javascript.replace(/<\/script/gi, '<\\/script');
  const safeNoBossMode = noBossMode.replace(/<\/script/gi, '<\\/script');
  const safeVisibilityScript = `
    <script>
      (() => {
        // The browser's system Chinese reader sounds like an unrelated female announcer.
        // Enemy callouts stay silent while Web Audio effects continue to work normally.
        const gameAudio = window.__criticalExtraction?.game?.audio;
        if (gameAudio) gameAudio.voice = () => {};
        const speech = globalThis.speechSynthesis;
        if (speech) {
          speech.cancel();
          try { speech.speak = () => {}; } catch {}
        }

        const setup = () => {
          const game = window.__criticalExtraction?.game;
          if (!game?.onVisibilityChange) return;
          document.removeEventListener('visibilitychange', game.onVisibilityChange);
          document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
              game.releaseHeldInputs?.();
              return;
            }
            game.webGlSuspendedInBackground = false;
            if (game.contextRestoreTimer) {
              window.clearTimeout(game.contextRestoreTimer);
              game.contextRestoreTimer = 0;
            }
          });
        };
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', setup, { once: true });
        } else {
          setup();
        }
      })();
    </script>`;
  const output = cleanShell
    .replace('</head>', () => `    <style>\n${styleParts.join('\n')}\n    </style>\n  </head>`)
    .replace('</body>', () => `    <script type="module">\n${safeJavascript}\n    </script>${safeVisibilityScript}\n    <script>\n${safeNoBossMode}\n    </script>\n  </body>`);

  const runtimeDirectory = '/tmp/critical-extraction-web';
  await Promise.all([
    mkdir(resolve(outputRoot, 'dist'), { recursive: true }),
    mkdir(runtimeDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(resolve(outputRoot, 'play.html'), output, 'utf8'),
    writeFile(resolve(outputRoot, 'dist/index.html'), output, 'utf8'),
    writeFile(join(runtimeDirectory, 'play.html'), output, 'utf8'),
  ]);
  console.log('Created play.html, dist/index.html, and the local preview copy');
} finally {
  await rm(temporaryBuild, { recursive: true, force: true });
}
