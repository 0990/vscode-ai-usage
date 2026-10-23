const { appendFileSync } = require('node:fs');
const manifest = require('../package.json');
const lock = require('../package-lock.json');

const tag = process.env.RELEASE_TAG;
const version = manifest.version;

if (!tag || (tag !== `v${version}` && tag !== version)) {
  throw new Error(`Release tag must be v${version} or ${version}, matching package.json; received ${JSON.stringify(tag)}.`);
}
if (lock.version !== version || lock.packages?.['']?.version !== version) {
  throw new Error('package-lock.json version must match package.json. Use npm version to update both.');
}

const vsix = `${manifest.name}-${version}.vsix`;
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nvsix=${vsix}\n`);
}
console.log(`Release ${tag}: ${vsix}`);
