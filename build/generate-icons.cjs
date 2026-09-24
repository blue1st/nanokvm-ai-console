const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: {
      offscreen: true,
    },
  });

  const svgPath = path.join(__dirname, 'icon.svg');
  const svgContent = fs.readFileSync(svgPath, 'utf-8');
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            width: 1024px;
            height: 1024px;
            background: transparent;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          svg {
            width: 1024px;
            height: 1024px;
          }
        </style>
      </head>
      <body>
        ${svgContent}
      </body>
    </html>
  `;

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

  // Allow browser time to paint
  await new Promise((r) => setTimeout(r, 1000));

  const image = await win.capturePage();
  const png1024Path = path.join(__dirname, 'icon.png');
  fs.writeFileSync(png1024Path, image.toPNG());
  console.log(`[IconGenerator] Generated base 1024x1024 PNG: ${png1024Path}`);

  // Create macOS iconset and ICNS
  const iconsetDir = path.join(__dirname, 'icon.iconset');
  if (fs.existsSync(iconsetDir)) {
    fs.rmSync(iconsetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(iconsetDir);

  const sizes = [
    { size: 16, name: 'icon_16x16.png' },
    { size: 32, name: 'icon_16x16@2x.png' },
    { size: 32, name: 'icon_32x32.png' },
    { size: 64, name: 'icon_32x32@2x.png' },
    { size: 128, name: 'icon_128x128.png' },
    { size: 256, name: 'icon_128x128@2x.png' },
    { size: 256, name: 'icon_256x256.png' },
    { size: 512, name: 'icon_256x256@2x.png' },
    { size: 512, name: 'icon_512x512.png' },
    { size: 1024, name: 'icon_512x512@2x.png' },
  ];

  for (const s of sizes) {
    const targetFile = path.join(iconsetDir, s.name);
    execSync(`sips -z ${s.size} ${s.size} "${png1024Path}" --out "${targetFile}"`, {
      stdio: 'pipe',
    });
  }

  // Run iconutil to create icon.icns
  const icnsPath = path.join(__dirname, 'icon.icns');
  execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`, { stdio: 'inherit' });
  console.log(`[IconGenerator] Generated macOS ICNS: ${icnsPath}`);

  // Generate 256x256 icon.ico (Simple ICO generator for Windows)
  // An ICO file contains a 6-byte header, 16-byte directory entry, and the PNG data.
  const png256Buf = fs.readFileSync(path.join(iconsetDir, 'icon_256x256.png'));
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0); // Reserved
  icoHeader.writeUInt16LE(1, 2); // Type 1 = ICO
  icoHeader.writeUInt16LE(1, 4); // Number of images = 1

  const icoEntry = Buffer.alloc(16);
  icoEntry.writeUInt8(0, 0); // Width 256 = 0
  icoEntry.writeUInt8(0, 1); // Height 256 = 0
  icoEntry.writeUInt8(0, 2); // Color palette
  icoEntry.writeUInt8(0, 3); // Reserved
  icoEntry.writeUInt16LE(1, 4); // Color planes
  icoEntry.writeUInt16LE(32, 6); // Bits per pixel
  icoEntry.writeUInt32LE(png256Buf.length, 8); // Image size in bytes
  icoEntry.writeUInt32LE(6 + 16, 12); // Offset to image data

  const icoBuffer = Buffer.concat([icoHeader, icoEntry, png256Buf]);
  const icoPath = path.join(__dirname, 'icon.ico');
  fs.writeFileSync(icoPath, icoBuffer);
  console.log(`[IconGenerator] Generated Windows ICO: ${icoPath}`);

  // Clean up iconset
  fs.rmSync(iconsetDir, { recursive: true, force: true });

  console.log('[IconGenerator] Icon generation completed successfully!');
  app.quit();
});
