import express, { type Router } from "express";
import { config } from "./config.js";
import { clearToken, isConnected, storeToken, subscriptionLimits, subscriptionView, tokenSource, validTokenFormat, verifyToken } from "./subscription.js";

const status = () => ({
  backend: config.backend,
  connected: isConnected(),
  source: tokenSource(),
  account: subscriptionView(),
  limits: subscriptionLimits(),
});

export const claudeLoginRouter = (): Router => {
  const router = express.Router();
  let verifying = false;

  router.get("/", (_req, res) => {
    res.json(status());
  });

  router.put("/", async (req, res) => {
    if (config.backend !== "subscription") {
      res.status(409).json({ error: "Plaudi läuft mit API-Schlüssel. Die Claude-Anmeldung ist nur mit AI_BACKEND=subscription aktiv." });
      return;
    }
    if (config.claudeToken) {
      res.status(409).json({ error: "Das Token kommt aus der Umgebungsvariable CLAUDE_CODE_OAUTH_TOKEN und lässt sich hier nicht ändern." });
      return;
    }
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!validTokenFormat(token)) {
      res.status(400).json({ error: "Das ist kein Claude-Token. Es beginnt mit sk-ant- und stammt aus „claude setup-token“." });
      return;
    }
    if (verifying) {
      res.status(429).json({ error: "Eine Prüfung läuft bereits." });
      return;
    }
    verifying = true;
    try {
      const result = await verifyToken(token);
      if (!result.ok) {
        res.status(400).json({ error: result.message });
        return;
      }
      storeToken(token);
      console.log("[claude] Abo-Token gespeichert");
      res.json(status());
    } finally {
      verifying = false;
    }
  });

  router.delete("/", (_req, res) => {
    if (config.claudeToken) {
      res.status(409).json({ error: "Das Token kommt aus der Umgebungsvariable und lässt sich hier nicht entfernen." });
      return;
    }
    clearToken();
    console.log("[claude] Abo-Token entfernt");
    res.json(status());
  });

  return router;
};
