import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'path';
import { existsSync, mkdirSync, statSync, utimesSync } from 'fs';
import { ValidatedOptions } from "./options";

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

const stringToArgs = (input: string): string[] => {
  return input.split(' ').filter(Boolean);
}

const ensureDirectoryExists = (filePath: string) => {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
};

// We assume that the output file will always be in the dst directory regardless of the name
const getOutputFileName = (input: string, options: ValidatedOptions): {
  output: string;
  finalName: string;
} => {
  const relativePath = relative(options.srcDir, input);
  const filename = basename(input);
  const originalExtension = extname(filename).slice(1);
  const filenameWithoutExtension = filename.slice(0, -originalExtension.length - 1);
  const subDir = dirname(relativePath);

  const result = {
    output: '',
    finalName: resolve(options.dstDir, subDir, `${filenameWithoutExtension}.${options.videoOptions.outputContainer}`),
  }
  if (options.srcDir === options.dstDir && options.videoOptions.outputContainer === originalExtension) {
    // If there is a name collision, we need to create a new file in the same directory with the temporary name and then rename it
    const suffix = '_encoded';
    result.output = resolve(options.dstDir, subDir, `${filenameWithoutExtension}${suffix}.${options.videoOptions.outputContainer}`);
    if (!options.deleteOriginal) {
      // the original file will be kept, so our final name will be the same as the output
      result.finalName = result.output;
    }
  } else {
    result.output = result.finalName;
  }

  return result;
}

const fixVideoStreamDimensions = (args: string[]) => {
  const index = args.indexOf('-vf');
  const cropFilter = 'crop=iw-mod(iw\\,2):ih-mod(ih\\,2)';

  if (index !== -1 && args[index + 1]) {
    // Merge the crop filter with the existing one
    args[index + 1] = `${cropFilter},${args[index + 1]}`;
  } else {
    args.push('-vf', cropFilter);
  }
}

const preserveAttributes = (file: string, mtimes: { atime: number, mtime: number }) => {
  if (mtimes.atime <= 0 || mtimes.mtime <= 0) {
    return;
  }
  utimesSync(file, new Date(mtimes.atime), new Date(mtimes.mtime));
}

export {
  validatePath,
  trimFileName,
  stringToArgs,
  getOutputFileName,
  fixVideoStreamDimensions,
  ensureDirectoryExists,
  preserveAttributes,
};
