import { existsSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { readFileSync } from "node:fs";
import { validateOptions } from "./validator";
import logger from "./logger";
import { validatePath } from "./utils";

const CONFIG = 'x264-converter.json' as const;

export interface Options {
  // directory to convert files at
  srcDir: string;
  // directory to save converted files, if not set, files are saved to src
  dstDir?: string;
  // whether to delete the original files on success
  deleteOriginal: boolean;
  // whether to preserve the file attributes of the original
  preserveAttributes: boolean;
  // stop on error or continue with the next file
  careful: boolean;
  // whether to scan subdirectories
  deep: number;
  // path to ffmpeg executable
  ffmpegPath?: string;
  // whether to skip checks and reencode every file
  skipProbe: boolean;
  videoOptions: {
    ffmpegCommand: string;
    outputContainer?: string
  }
  filterBy?: {
    // filter by file extension
    extension?: string;
    // filter by codec
    codec?: string;
  }
}

export interface ValidatedOptions extends Options {
  dstDir: string;
  videoOptions: {
    ffmpegCommand: string;
    outputContainer: string;
  }
}

const defaultOptions: Options = {
  srcDir: '',
  dstDir: '',
  deleteOriginal: false,
  preserveAttributes: true,
  careful: false,
  deep: 0,
  skipProbe: false,
  videoOptions: {
    ffmpegCommand: '',
    outputContainer: 'mp4',
  }
}

const optionsExists = (directoryOrFile: string): boolean => {
  const stats = existsSync(directoryOrFile) ? statSync(directoryOrFile) : null;
  if (!stats) {
    return false;
  }

  if (stats.isFile()) {
    return true;
  }

  if (!stats.isDirectory()) {
    throw new Error(`Invalid path: ${directoryOrFile}`);
  }

  const configPath = join(directoryOrFile, CONFIG);
  return existsSync(configPath);
}

const getDefaultOptions = (): Options => {
  return structuredClone(defaultOptions);
}

const saveOptions = (options: Options, directory: string): void => {
  const json = JSON.stringify(options, null, 2);
  const configPath = join(directory, CONFIG);
  writeFileSync(configPath, json);
}

const validateDirectory = (directory: string): string => {
  if (!directory) {
    throw new Error('Directory is required');
  }

  const stats = statSync(directory);
  if (!stats.isDirectory()) {
    throw new Error(`Invalid directory: ${directory}`);
  }

  return validatePath(directory, dirname(directory));
}

const loadOptions = (directoryOrFile: string): ValidatedOptions => {
  if (!directoryOrFile) {
    throw new Error('Directory or file is required');
  }

  const stats = statSync(directoryOrFile);
  const configPath = stats.isDirectory() ? join(directoryOrFile, CONFIG) : directoryOrFile;

  if (!existsSync(configPath)) {
    throw new Error(`Config file not found at '${configPath}'`);
  }

  const json = readFileSync(configPath, 'utf-8');
  const options = JSON.parse(json);
  if (!validateOptions(options)) {
    throw new Error('Invalid config file');
  } else {
    logger.info(`Config file loaded from '${configPath}'`);
  }

  options.srcDir = validateDirectory(options.srcDir);
  options.dstDir = options.dstDir ? validateDirectory(options.dstDir) : options.srcDir;
  if (!options.videoOptions.outputContainer) {
    options.videoOptions.outputContainer = 'mp4';
  } else if (options.videoOptions.outputContainer.startsWith('.')) {
    options.videoOptions.outputContainer = options.videoOptions.outputContainer.slice(1);
  }

  return { ...getDefaultOptions(), ...options } as ValidatedOptions;
}

export { optionsExists, getDefaultOptions, saveOptions, loadOptions };
