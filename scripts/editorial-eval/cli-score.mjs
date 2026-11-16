// Vite loads the same TypeScript as the app.
import { createServer } from 'vite';
let server;
try {
  server = await createServer({ mode: 'editorial-eval', server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  const { main } = await server.ssrLoadModule('/scripts/editorial-eval/score.ts');
  await main(process.argv.slice(2));
} catch (error) {
  const code = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'score_failed';
  console.error(JSON.stringify({ status: 'error', code }));
  process.exitCode = 1;
} finally {
  await server?.close();
}
