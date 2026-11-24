import path from "node:path";
import sharp from "sharp";

const input = process.argv[2];
const out = path.resolve(process.argv[3] ?? "../../frontend/public");

if (!input) {
  console.error("Aufruf: npm start -- <logo.png> [zielordner]");
  process.exit(1);
}

const trimmed = await sharp(input).ensureAlpha().unflatten().trim({ threshold: 12 }).toBuffer({ resolveWithObject: true });
const { width, height } = trimmed.info;
const targetHeight = 160;
const targetWidth = Math.round((width / height) * targetHeight);

await sharp(trimmed.data)
  .resize({ height: targetHeight * 2, fit: "inside" })
  .png({ compressionLevel: 9 })
  .toFile(path.join(out, "logo.png"));

const mark = await sharp(trimmed.data)
  .extract({ left: 0, top: 0, width: Math.min(height, width), height })
  .resize(192, 192, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
  .png()
  .toBuffer();

await sharp(mark).resize(64, 64).png().toFile(path.join(out, "favicon.png"));
await sharp({ create: { width: 180, height: 180, channels: 4, background: "#ffffff" } })
  .composite([{ input: await sharp(mark).resize(140, 140).png().toBuffer(), gravity: "center" }])
  .png()
  .toFile(path.join(out, "apple-touch-icon.png"));

console.log(`Logo zugeschnitten (${width}x${height} -> Anzeige ${targetWidth}x${targetHeight}) und Icons nach ${out} geschrieben.`);
