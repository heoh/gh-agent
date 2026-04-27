import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'glob';

const sourceBaseDir = 'src';
const targetBaseDir = 'dist';
const includePatterns = ['**/*.md'];

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '..');

const sourceRoot = path.join(projectRoot, sourceBaseDir);
const targetRoot = path.join(projectRoot, targetBaseDir);
const filesToCopy = await glob(includePatterns, {
  cwd: sourceRoot,
  nodir: true,
  posix: true,
});

for (const relativeFile of filesToCopy) {
  const sourcePath = path.join(sourceRoot, relativeFile);
  const targetPath = path.join(targetRoot, relativeFile);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, { force: true });
}

console.log(`copied ${filesToCopy.length} asset file(s) to ${targetBaseDir}/`);
