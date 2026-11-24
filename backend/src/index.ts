import fs from "node:fs";
import path from "node:path";
import compression from "compression";
import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import { authRequired, authRouter, requireAuth } from "./auth.js";
import { config } from "./config.js";
import { closeDb, counts } from "./db.js";
import { apiRouter } from "./routes.js";

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", config.trustProxy);

app.use((_req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  });
  next();
});

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, authRequired: authRequired(), apiConfigured: config.hasCredentials, ...counts() });
});

app.use("/api/auth", authRouter());
app.use("/api", requireAuth, apiRouter());

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Nicht gefunden." });
});

const indexFile = path.join(config.publicDir, "index.html");

if (fs.existsSync(indexFile)) {
  app.use(compression());
  app.use(
    express.static(config.publicDir, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexFile);
  });
} else {
  app.get("/", (_req, res) => {
    res.type("text/plain").send("Frontend nicht gefunden. Im Entwicklungsmodus Vite starten oder das Docker-Image verwenden.");
  });
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status =
    typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
      ? error.status
      : 500;
  if (status >= 500) console.error("[server]", error);
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(status).json({ error: status === 400 ? "Ungültige Anfrage." : status === 413 ? "Anfrage zu groß." : "Serverfehler." });
});

const server = app.listen(config.port, () => {
  console.log(`Chatbot läuft auf Port ${config.port}`);
  console.log(`Modell: ${config.model} (effort ${config.effort}), Fallback: ${config.enableFallback ? "an" : "aus"}`);
  console.log(`Gedächtnis: ${config.memoryDays} Tage, übergreifend: ${config.crossChatMemory ? "an" : "aus"}`);
  console.log(`Passwortschutz: ${authRequired() ? "an" : "aus"}`);
  if (!config.hasCredentials) {
    console.warn("WARNUNG: ANTHROPIC_API_KEY ist nicht gesetzt. Antworten sind erst mit gültigem Schlüssel möglich.");
  }
});

server.requestTimeout = 0;
server.headersTimeout = 65000;
server.keepAliveTimeout = 65000;

const shutdown = (signal: string): void => {
  console.log(`${signal} empfangen, fahre herunter`);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => {
    closeDb();
    process.exit(0);
  }, 5000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
