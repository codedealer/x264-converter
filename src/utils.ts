import { isAbsolute, resolve, sep } from 'path';
import { statSync } from 'fs';

const validatePath = (inputPath: string, baseDirectory: string): string => {
  if (!isAbsolute(inputPath)) {
    inputPath = resolve(baseDirectory, inputPath);
  }

  const resolvedBase = resolve(baseDirectory) + sep;
  const resolvedPath = resolve(inputPath);

  if (!resolvedPath.startsWith(resolvedBase)) {
    throw new Error(`Invalid path: ${inputPath} is outside of the base directory`);
  }

  const stats = statSync(resolvedPath);
  if (!stats.isFile() && !stats.isDirectory()) {
    throw new Error(`Invalid path: ${inputPath}`);
  }

  return resolvedPath;
};

const trimFileName = (filename: string, maxLength = 15): string => {
  if (filename.length <= maxLength) {
    return filename;
  }

  const prefixLength = Math.ceil((maxLength - 3) / 2);
  const suffixLength = maxLength - prefixLength - 3;

  return `${filename.slice(0, prefixLength)}...${filename.slice(-suffixLength)}`;
}

export { validatePath, trimFileName };
