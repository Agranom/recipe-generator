// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');

const envFilePath = path.resolve(__dirname, '.env.test');

if (!fs.existsSync(envFilePath)) {
  throw new Error('.env.test file is missing.');
}

console.log('.env.test file is present.');
