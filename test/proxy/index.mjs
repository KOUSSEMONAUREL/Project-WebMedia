/**
 * WebMedia Test Proxy — remplace le Cloudflare Worker localement
 * Proxy HTTP simple : port 8788 → backend :8787
 */

import http from "node:http";

const BACKEND_HOST = process.env.BACKEND_HOST || "localhost";
const BACKEND_PORT = parseInt(process.env.BACKEND_PORT || "8787");
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "8788");

const server = http.createServer((req, res) => {
  const backendReq = http.request(
    {
      hostname: BACKEND_HOST,
      port: BACKEND_PORT,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        "X-Forwarded-For": req.socket.remoteAddress || "127.0.0.1",
      },
    },
    (backendRes) => {
      res.writeHead(backendRes.statusCode, backendRes.headers);
      backendRes.pipe(res);
    },
  );

  backendReq.on("error", (err) => {
    console.error(`[proxy] Error proxying ${req.method} ${req.url}:`, err.message);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Backend unavailable" }));
  });

  req.pipe(backendReq);
});

server.listen(PROXY_PORT, "0.0.0.0", () => {
  console.log(`[proxy] :${PROXY_PORT} → backend :${BACKEND_PORT}`);
});

process.on("SIGTERM", () => server.close());
process.on("SIGINT", () => server.close());
