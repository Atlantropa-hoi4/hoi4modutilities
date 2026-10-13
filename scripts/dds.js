// npm run compile-tests
// node --prof scripts/dds.js <dds-file> [repeat-count]

const dds = require("../out/src/util/image/dds/dds");
const fs = require("fs");

const inputFile = process.argv[2];
if (!inputFile) {
    throw new Error("Usage: node scripts/dds.js <dds-file> [repeat-count]");
}
const repeatCount = process.argv.length > 3 ? parseInt(process.argv[3], 10) : 100;
const startTime = process.hrtime();

for (let i = 0; i < repeatCount; i++) {
    const file = fs.readFileSync(inputFile);
    const ddsFile = dds.DDS.parse(file.buffer);
    const fullRGBA = ddsFile.images[0].getFullRgba();

    console.log(fullRGBA.length, fullRGBA[fullRGBA.length - 1]);
}

const endTime = process.hrtime(startTime);
console.log("Repeat count: %d, Average time: %dms", repeatCount, (endTime[0] * 1000 + endTime[1] / 1000000) / repeatCount);
