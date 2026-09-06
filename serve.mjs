/** Dependency-free development server. Binds only to loopback by default. */
import http from 'node:http';
import {readFile, realpath, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root = await realpath(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const headers = {
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer',
 'Cache-Control':'no-store',
 'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; img-src 'self' data: blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
};
const server = http.createServer(async (req,res) => {
 try {
  if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405,{...headers,Allow:'GET, HEAD'});res.end();return;}
  const url = new URL(req.url,'http://localhost');
  const requestPath = decodeURIComponent(url.pathname);
  if (requestPath.includes('\0')) throw new Error('Invalid path');
  const candidate = path.resolve(root, '.' + (requestPath === '/' ? '/index.html' : requestPath));
  const file = await realpath(candidate);
  if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
  const type = mime[path.extname(file)];
  if (!type || !(await stat(file)).isFile()) throw new Error('Invalid file');
  const bytes = await readFile(file);
  res.writeHead(200,{...headers,'Content-Type':type,'Content-Length':bytes.byteLength});
  res.end(req.method === 'HEAD' ? undefined : bytes);
 } catch {res.writeHead(404,{...headers,'Content-Type':'text/plain'});res.end('Not found');}
});
server.on('error', error => {console.error(`Cannot start Axiom CAD: ${error.message}`);process.exitCode=1;});
server.listen(port,host,()=>console.log(`Axiom CAD → http://${host}:${port}\nPress Ctrl+C to stop.`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>process.exit(0)));
