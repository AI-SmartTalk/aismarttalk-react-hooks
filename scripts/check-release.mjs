import { appendFileSync, readFileSync } from 'node:fs';
import { isPublished, releaseVersion } from './release-policy.mjs';
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const version = releaseVersion(process.env.RELEASE_TAG, manifest);
const published = await isPublished(version);
console.log(`${manifest.name}@${version}: ${published ? 'already published' : 'ready to publish'}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `published=${published}\n`);
