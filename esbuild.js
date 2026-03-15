const esbuild = require('esbuild');
const watch = process.argv.includes('--watch');

(async () => {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: true,
    minify: !watch,
  });

  if (watch) {
    await ctx.watch();
    console.log('[esbuild] Watching for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log('[esbuild] Build complete.');
  }
})();
