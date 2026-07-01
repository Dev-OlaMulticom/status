import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

function statusJsonBridge(): Plugin {
  let statusPath = '';
  let sitesConfigPath = '';
  let outputPath = '';
  let outputSitesConfigPath = '';
  let projectRoot = '';

  function runCommand(cmd: string, args: string[], cwd: string, timeoutMs = 180000): Promise<void> {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        rejectPromise(new Error(`Command timeout: ${cmd} ${args.join(' ')}`));
      }, timeoutMs);

      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        rejectPromise(error);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolvePromise();
          return;
        }
        const msg = stderr.trim() || `Exit code ${code}`;
        rejectPromise(new Error(msg));
      });
    });
  }

  return {
    name: 'status-json-bridge',
    configResolved(config) {
      projectRoot = resolve(config.root, '..');
      statusPath = resolve(config.root, '../status.json');
      sitesConfigPath = resolve(config.root, '../sites-config.json');
      outputPath = resolve(config.root, config.build.outDir, 'status.json');
      outputSitesConfigPath = resolve(config.root, config.build.outDir, 'sites-config.json');
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method === 'GET' && req.url === '/__admin/health') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (req.method === 'POST' && req.url === '/__admin/regenerate') {
          (async () => {
            try {
              await runCommand('npm', ['run', 'cache:clear'], projectRoot);
              await runCommand('npm', ['run', 'monitor'], projectRoot);
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ ok: true }));
            } catch (error) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ ok: false, error: (error as Error).message }));
            }
          })();
          return;
        }

        if (req.url !== '/status.json' && req.url !== '/sites-config.json') {
          next();
          return;
        }

        try {
          const sourcePath = req.url === '/status.json' ? statusPath : sitesConfigPath;
          const json = readFileSync(sourcePath, 'utf8');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(json);
        } catch {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: `No se pudo leer ${req.url}` }));
        }
      });
    },
    closeBundle() {
      try {
        const json = readFileSync(statusPath, 'utf8');
        writeFileSync(outputPath, json);
      } catch {
        // Keep build successful even if status file is temporarily missing.
      }
      try {
        const json = readFileSync(sitesConfigPath, 'utf8');
        writeFileSync(outputSitesConfigPath, json);
      } catch {
        // sites-config.json is optional.
      }
    }
  };
}

export default defineConfig({
  plugins: [statusJsonBridge()],
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
  }
});
