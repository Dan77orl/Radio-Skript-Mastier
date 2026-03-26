import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  app.use("*", (req, res) => {
    const url = req.originalUrl || req.url;
    if (url.startsWith("/audio/") || url.match(/\.(mp3|wav|ogg|m4a)$/i)) {
      return res.status(404).json({ error: "Audio file not found" });
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
