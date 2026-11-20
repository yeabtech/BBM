import { mkdir, readFile, writeFile } from "node:fs/promises";
import { deflateSync, inflateSync } from "node:zlib";

const sourcePath = new URL("../apps/client/public/image.png", import.meta.url);
const outputDirectory = new URL(
  "../apps/client/public/assets/terrain/",
  import.meta.url,
);
const source = await readFile(sourcePath);
const width = source.readUInt32BE(16);
const height = source.readUInt32BE(20);
if (source[24] !== 8 || source[25] !== 6 || source[28] !== 0)
  throw new Error("Expected a non-interlaced 8-bit RGBA PNG tileset.");

const chunks = [];
for (let offset = 8; offset < source.length;) {
  const length = source.readUInt32BE(offset);
  const type = source.toString("ascii", offset + 4, offset + 8);
  if (type === "IDAT")
    chunks.push(source.subarray(offset + 8, offset + 8 + length));
  offset += length + 12;
  if (type === "IEND") break;
}

const stride = width * 4;
const decoded = inflateSync(Buffer.concat(chunks));
const pixels = Buffer.alloc(stride * height);
let cursor = 0;
for (let y = 0; y < height; y += 1) {
  const filter = decoded[cursor++];
  const row = y * stride;
  const previous = row - stride;
  for (let x = 0; x < stride; x += 1) {
    const left = x >= 4 ? pixels[row + x - 4] : 0;
    const above = y > 0 ? pixels[previous + x] : 0;
    const upperLeft = y > 0 && x >= 4 ? pixels[previous + x - 4] : 0;
    const value = decoded[cursor++];
    let predictor = 0;
    if (filter === 1) predictor = left;
    else if (filter === 2) predictor = above;
    else if (filter === 3) predictor = Math.floor((left + above) / 2);
    else if (filter === 4) {
      const p = left + above - upperLeft;
      const dl = Math.abs(p - left);
      const da = Math.abs(p - above);
      const du = Math.abs(p - upperLeft);
      predictor = dl <= da && dl <= du ? left : da <= du ? above : upperLeft;
    }
    pixels[row + x] = (value + predictor) & 255;
  }
}

const rectangles = [
  // Platform crops include the original grass fringe above the collision top.
  {
    name: "ground-650x100.png",
    x: 17,
    y: 15,
    width: 650,
    height: 100,
    topOffset: 38,
    geometry: [650, 100],
    extend: 600,
    dirtBands: [
      { x: 17, y: 115, height: 48 },
      { x: 200, y: 260, height: 64 },
    ],
    dirtTile: { x: 200, y: 260, height: 64 },
  },
  { name: "ground-edge-left.png", x: 17, y: 15, width: 64, height: 153 },
  { name: "ground-edge-right.png", x: 995, y: 15, width: 64, height: 153 },
  {
    name: "platform-260x32.png",
    x: 242,
    y: 15,
    width: 260,
    height: 104,
    topOffset: 37,
    geometry: [260, 32],
    dirtHeight: 56,
    compose: true,
  },
  {
    name: "ground-260x100.png",
    x: 200,
    y: 193,
    width: 260,
    height: 90,
    topOffset: 25,
    geometry: [260, 100],
    extend: 600,
    dirtBands: [
      { x: 200, y: 283, height: 40 },
      { x: 242, y: 115, height: 48 },
    ],
    dirtTile: { x: 242, y: 100, height: 56 },
  },
  {
    name: "platform-250x32.png",
    x: 537,
    y: 15,
    width: 250,
    height: 104,
    topOffset: 37,
    geometry: [250, 32],
    dirtHeight: 56,
    compose: true,
  },
  {
    name: "ground-680x100.png",
    x: 379,
    y: 193,
    width: 680,
    height: 90,
    topOffset: 25,
    geometry: [680, 100],
    extend: 600,
    dirtBands: [
      { x: 379, y: 283, height: 40 },
      { x: 379, y: 115, height: 48 },
    ],
    dirtTile: { x: 379, y: 100, height: 56 },
  },
  { name: "platform-edge-left.png", x: 16, y: 193, width: 64, height: 133 },
  { name: "platform-edge-right.png", x: 995, y: 193, width: 64, height: 133 },
  {
    name: "platform-110x24.png",
    x: 617,
    y: 15,
    width: 110,
    height: 104,
    topOffset: 37,
    geometry: [110, 24],
    dirtHeight: 56,
    compose: true,
  },
  {
    name: "platform-150x24.png",
    x: 782,
    y: 15,
    width: 150,
    height: 104,
    topOffset: 37,
    geometry: [150, 24],
    dirtHeight: 56,
    compose: true,
  },
  {
    name: "moving-100x20.png",
    x: 117,
    y: 15,
    width: 100,
    height: 104,
    topOffset: 37,
    geometry: [100, 20],
    dirtHeight: 56,
    compose: true,
  },
  {
    name: "moving-84x20.png",
    x: 942,
    y: 15,
    width: 84,
    height: 104,
    topOffset: 37,
    geometry: [84, 20],
    dirtHeight: 56,
    compose: true,
  },
  // Standalone artwork elements are retained as reusable source crops.
  { name: "grass-clump-a.png", x: 16, y: 687, width: 102, height: 58 },
  { name: "grass-clump-b.png", x: 158, y: 687, width: 85, height: 58 },
  { name: "flower-pink.png", x: 714, y: 708, width: 28, height: 37 },
  { name: "flower-white.png", x: 772, y: 693, width: 35, height: 57 },
  { name: "flower-yellow.png", x: 850, y: 703, width: 35, height: 47 },
  { name: "flower-purple.png", x: 925, y: 693, width: 40, height: 57 },
  { name: "flower-small.png", x: 1016, y: 703, width: 20, height: 32 },
  { name: "stone-cluster.png", x: 1177, y: 697, width: 87, height: 63 },
  { name: "bush-cluster.png", x: 245, y: 774, width: 128, height: 79 },
];

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit += 1)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const label = Buffer.from(type);
  const checksumData = Buffer.concat([label, data]);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  label.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(checksumData), data.length + 8);
  return result;
}
function encodePng(crop) {
  const cropWidth = crop.width;
  const cropHeight = crop.extend
    ? crop.height + crop.extend
    : crop.compose
      ? crop.topOffset + 11 + crop.dirtHeight
      : crop.height;
  const raw = Buffer.alloc((cropWidth * 4 + 1) * cropHeight);
  const copySourceRows = (sourceX, sourceY, count, destinationY) => {
    for (let row = 0; row < count; row += 1) {
      const target = (destinationY + row) * (cropWidth * 4 + 1);
      raw[target] = 0;
      pixels.copy(
        raw,
        target + 1,
        (sourceY + row) * stride + sourceX * 4,
        (sourceY + row) * stride + (sourceX + cropWidth) * 4,
      );
    }
  };
  if (crop.compose) {
    // Narrow platforms use the source grass crown plus a 56px soil slice at native scale.
    const crownHeight = crop.topOffset + 11;
    copySourceRows(crop.x, 15, crownHeight, 0);
    copySourceRows(crop.x, 100, crop.dirtHeight, crownHeight);
  } else {
    for (let row = 0; row < crop.height; row += 1) {
      const target = row * (cropWidth * 4 + 1);
      raw[target] = 0;
      pixels.copy(
        raw,
        target + 1,
        (crop.y + row) * stride + crop.x * 4,
        (crop.y + row) * stride + (crop.x + cropWidth) * 4,
      );
    }
    if (crop.extend) {
      let written = 0;
      for (const band of crop.dirtBands) {
        copySourceRows(band.x, band.y, band.height, crop.height + written);
        written += band.height;
      }
      while (written < crop.extend) {
        const count = Math.min(crop.dirtTile.height, crop.extend - written);
        copySourceRows(
          crop.dirtTile.x,
          crop.dirtTile.y,
          count,
          crop.height + written,
        );
        written += count;
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(cropWidth, 0);
  header.writeUInt32BE(cropHeight, 4);
  header[8] = 8;
  header[9] = 6;
  // The sheet's green vignette is partially opaque everywhere. Keep the source RGB
  // unchanged, but clear its low-opacity backdrop so extracted terrain has clean edges.
  for (let row = 0; row < cropHeight; row += 1) {
    const rowStart = row * (cropWidth * 4 + 1) + 1;
    for (let x = 0; x < cropWidth; x += 1) {
      const alpha = rowStart + x * 4 + 3;
      if (raw[alpha] < 200) raw[alpha] = 0;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const rect of rectangles) {
  const maxY = rect.compose
    ? 100 + rect.dirtHeight
    : rect.extend
      ? Math.max(
          rect.y + rect.height,
          ...rect.dirtBands.map((band) => band.y + band.height),
          rect.dirtTile.y + rect.dirtTile.height,
        )
      : rect.y + rect.height;
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > width || maxY > height)
    throw new Error(
      `Crop ${rect.name} is outside the ${width}x${height} source.`,
    );
}
await mkdir(outputDirectory, { recursive: true });
for (const rect of rectangles)
  await writeFile(new URL(rect.name, outputDirectory), encodePng(rect));
await writeFile(
  new URL("manifest.json", outputDirectory),
  JSON.stringify(
    {
      source: "../../image.png",
      sourceSize: [width, height],
      sourceFormat: "8-bit RGBA",
      extraction:
        "Original RGB values and alpha >= 200 are retained; low-opacity green vignette pixels are made transparent. Ground dirt extensions repeat an unscaled source dirt band.",
      crops: rectangles.map((rect) => ({
        ...rect,
        outputSize: [
          rect.width,
          rect.extend ? rect.height + rect.extend : rect.height,
        ],
        sourceRegions: rect.compose
          ? [
              {
                x: rect.x,
                y: 15,
                width: rect.width,
                height: rect.topOffset + 11,
              },
              { x: rect.x, y: 100, width: rect.width, height: rect.dirtHeight },
            ]
          : [
              { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              ...(rect.extend
                ? [
                    ...rect.dirtBands.map((band) => ({
                      ...band,
                      width: rect.width,
                    })),
                    {
                      ...rect.dirtTile,
                      width: rect.width,
                      repeats: Math.ceil(
                        Math.max(
                          0,
                          rect.extend -
                            rect.dirtBands.reduce(
                              (sum, band) => sum + band.height,
                              0,
                            ),
                        ) / rect.dirtTile.height,
                      ),
                    },
                  ]
                : []),
            ],
      })),
    },
    null,
    2,
  ),
);
console.log(
  `Prepared ${rectangles.length} source-art assets from ${width}x${height} image.png.`,
);
