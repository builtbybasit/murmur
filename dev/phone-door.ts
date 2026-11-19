// The phone's way in: an HTTPS server on your network (Vite port + 1000) that passes every
// request, and the live-reload WebSocket, to the dev server, which stays on localhost. The Mac
// keeps using http://localhost (no certificate warning, same browser storage as before); phones
// get HTTPS, which they need for lock-screen controls.
import { getCertificate } from "@vitejs/plugin-basic-ssl";
import { request, type IncomingHttpHeaders } from "node:http";
import { createServer } from "node:https";
import { connect } from "node:net";

/** Marks a request that came through the door; the key check applies to it (see `guard`). */
export const VIA = "x-murmur-remote";

export async function openPhoneDoor(
  target: number,
  certDir: string,
): Promise<{ port: number; close: () => void } | null> {
  const pem = await getCertificate(certDir, "murmur"); // key and cert in one PEM
  const port = target + 1000;
  const headersFor = (h: IncomingHttpHeaders, remote = "") => ({ ...h, [VIA]: remote || "1" });

  const door = createServer({ key: pem, cert: pem }, (req, res) => {
    const up = request(
      {
        host: "localhost",
        port: target,
        method: req.method,
        path: req.url,
        headers: headersFor(req.headers, req.socket.remoteAddress),
      },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    up.on("error", () => {
      res.statusCode = 502;
      res.end();
    });
    res.on("close", () => up.destroy());
    req.pipe(up);
  });

  // WebSocket upgrades (Vite's live reload): replay the request head, then pipe both ways
  door.on("upgrade", (req, socket, head) => {
    const up = connect(target, "localhost", () => {
      const h = headersFor(req.headers, req.socket.remoteAddress);
      const lines = Object.entries(h).flatMap(([k, v]) =>
        v === undefined ? [] : (Array.isArray(v) ? v : [v]).map((x) => `${k}: ${x}`),
      );
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join("\r\n")}\r\n\r\n`);
      up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  });

  return new Promise((resolve) => {
    door.once("error", (e) => {
      console.error(`murmur: phone access is off, port ${port} is busy (${e.message})`);
      resolve(null);
    });
    door.listen(port, "0.0.0.0", () =>
      resolve({
        port,
        close: () => {
          door.close();
          door.closeAllConnections();
        },
      }),
    );
  });
}
