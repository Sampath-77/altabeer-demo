import fs from "fs";
import path from "path";
import sharp from "sharp";

const sourcePath = "C:/Users/India/.gemini/antigravity/brain/5145d253-30b6-4a96-9c9e-7445aea88842/.user_uploaded/media_1793708203787_cc2c13af.jpg";
const publicDir = path.resolve(__dirname, "../public");
const brandDir = path.join(publicDir, "brand");
const iconsDir = path.join(publicDir, "icons");

fs.mkdirSync(brandDir, { recursive: true });
fs.mkdirSync(iconsDir, { recursive: true });

async function generate() {
  console.log("Reading source emblem from:", sourcePath);
  const sourceBuffer = fs.readFileSync(sourcePath);

  // 1. Save original emblem as JPEG and PNG in public/brand/
  fs.writeFileSync(path.join(brandDir, "al-tabeer-emblem.jpg"), sourceBuffer);
  await sharp(sourceBuffer)
    .png({ quality: 100, compressionLevel: 9 })
    .toFile(path.join(brandDir, "al-tabeer-emblem.png"));
  console.log("Saved full-resolution emblem in public/brand/");

  // Also make available at root /brand-emblem.png for simple referencing
  await sharp(sourceBuffer)
    .png({ quality: 100 })
    .toFile(path.join(publicDir, "brand-emblem.png"));

  // 2. Favicons
  const sizes = [
    { name: "favicon-16x16.png", size: 16 },
    { name: "favicon-32x32.png", size: 32 },
    { name: "favicon-48x48.png", size: 48 },
    { name: "apple-touch-icon.png", size: 180 },
    { name: "icons/icon-192.png", size: 192 },
    { name: "icons/icon-512.png", size: 512 },
  ];

  for (const s of sizes) {
    const outPath = path.join(publicDir, s.name);
    await sharp(sourceBuffer)
      .resize(s.size, s.size, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(outPath);
    console.log(`Generated ${s.name} (${s.size}x${s.size})`);
  }

  // 3. Generate favicon.ico (multi-resolution ICO container containing 16, 32, 48)
  // Simple ICO builder
  const b16 = await sharp(sourceBuffer).resize(16, 16).png().toBuffer();
  const b32 = await sharp(sourceBuffer).resize(32, 32).png().toBuffer();
  const b48 = await sharp(sourceBuffer).resize(48, 48).png().toBuffer();

  const icoBuffer = buildIco([
    { size: 16, png: b16 },
    { size: 32, png: b32 },
    { size: 48, png: b48 },
  ]);
  fs.writeFileSync(path.join(publicDir, "favicon.ico"), icoBuffer);
  console.log("Generated favicon.ico");

  // 4. Manifest.json
  const manifest = {
    name: "Al Tabeer Delivery Services",
    short_name: "Al Tabeer",
    description: "Al Tabeer Delivery Services Driver & Admin Portal",
    start_url: "/",
    display: "standalone",
    background_color: "#1a2748",
    theme_color: "#1a2748",
    icons: [
      {
        src: "/favicon-32x32.png",
        sizes: "32x32",
        type: "image/png"
      },
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png"
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png"
      }
    ]
  };
  fs.writeFileSync(path.join(publicDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log("Generated manifest.json");
}

function buildIco(images: { size: number; png: Buffer }[]): Buffer {
  // ICO header: 6 bytes
  // ICONDIR: reserved (2 bytes: 0), type (2 bytes: 1 for ICO), count (2 bytes: images.length)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  // Each ICONDIRENTRY: 16 bytes
  const entrySize = 16;
  const dirSize = 6 + images.length * entrySize;
  let offset = dirSize;

  const entries: Buffer[] = [];
  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(img.size >= 256 ? 0 : img.size, 0); // width
    entry.writeUInt8(img.size >= 256 ? 0 : img.size, 1); // height
    entry.writeUInt8(0, 2); // color palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(img.png.length, 8); // size of image data
    entry.writeUInt32LE(offset, 12); // offset to image data
    entries.push(entry);
    offset += img.png.length;
  }

  return Buffer.concat([header, ...entries, ...images.map(img => img.png)]);
}

generate().catch(err => {
  console.error("Error generating branding assets:", err);
  process.exit(1);
});

