import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';

type ProxyHandle = {
  url: string;
  close: () => Promise<void>;
};

export const startHttpsProxyToHttp = async (opts: {
  listenHost: string;
  listenPort: number;
  targetHost: string;
  targetPort: number;
}): Promise<ProxyHandle> => {
  const keyPath = path.join(__dirname, 'fixtures', 'localhost.key');
  const certPath = path.join(__dirname, 'fixtures', 'localhost.crt');
  const key = fs.readFileSync(keyPath);
  const cert = fs.readFileSync(certPath);

  const server = https.createServer({ key, cert }, (req, res) => {
    const targetReq = http.request(
      {
        hostname: opts.targetHost,
        port: opts.targetPort,
        method: req.method,
        path: req.url,
        headers: {
          ...req.headers,
          host: `${opts.targetHost}:${opts.targetPort}`,
          'x-forwarded-proto': 'https',
          'x-forwarded-host': `${opts.listenHost}:${opts.listenPort}`,
        },
      },
      (targetRes) => {
        res.writeHead(targetRes.statusCode || 502, targetRes.headers as Record<string, string>);
        targetRes.pipe(res);
      }
    );

    targetReq.on('error', (err) => {
      res.statusCode = 502;
      res.setHeader('content-type', 'text/plain');
      res.end(`proxy error: ${String(err)}`);
    });

    req.pipe(targetReq);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.listenPort, opts.listenHost, () => resolve());
  });

  return {
    url: `https://${opts.listenHost}:${opts.listenPort}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
};

