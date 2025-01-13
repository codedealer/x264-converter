import logger from "./logger";
import { dirname, isAbsolute, join } from "path";
import { initializeDatabase } from "./db";
import { statSync } from "fs";
import { validatePath } from "./utils";
import { getDefaultOptions, loadOptions, optionsExists, saveOptions } from "./options";
import inquirer from "inquirer";
import { FFmpegExecutor } from "./ffmpeg";

const getWorkingDirectoryOrConfigFile = (): string => {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    return process.cwd();
  }

  const path = isAbsolute(args[0]) ? args[0] : join(process.cwd(), args[0]);
  const stats = statSync(path);

  if (!stats.isFile() && !stats.isDirectory()) {
    throw new Error(`Only path to a file or directory is supported: ${path}`);
  }

  const baseDirectory = stats.isDirectory() ? path : dirname(path);

  return validatePath(path, baseDirectory);
};

/**
 * Check ffmpeg path by getting its version. If the config path is not provided try calling it as ffmpeg in case it's in the PATH.
 * @param pathFromConfig
 */
const getFFMpegVersion = async (pathFromConfig?: string): Promise<string> => {
  const ffmpegExecutor = new FFmpegExecutor(pathFromConfig);

  logger.debug(`Checking ffmpeg path: ${ffmpegExecutor.command}`);

  ffmpegExecutor.on('stderr', (data) => {
    logger.error(data);
  });
  let output = '';
  ffmpegExecutor.on('stdout', (data) => {
    logger.debug(`Message: ${data}`);

    output += data;
  });

  try {
    await ffmpegExecutor.execute(['-version', '-hide_banner']);
  } finally {
    ffmpegExecutor.removeAllListeners();
  }

  const version = output.match(/ffmpeg version (\S+)/);
  if (Array.isArray(version) && version.length > 1) {
    return version[1];
  } else {
    throw new Error('Could not identify ffmpeg version');
  }
}

const bootstrap = async () => {
  logger.info(`x264 Converter`);
  logger.debug('Debugging enabled');

  const dbDir = 'pkg' in process ? dirname(process.execPath) : process.cwd();
  const dbPath = join(dbDir, 'x264-db.sqlite');
  logger.debug(`Database directory: ${dbDir}`);
  initializeDatabase(dbPath);

  const dirOrConfig = getWorkingDirectoryOrConfigFile();
  logger.debug(`Checking: ${dirOrConfig}`);
  if (!optionsExists(dirOrConfig)) {
    logger.info(`Config file not found at '${dirOrConfig}'. Creating the default config file.`);
    const options = getDefaultOptions();
    const stats = statSync(dirOrConfig);
    options.srcDir = stats.isDirectory() ? dirOrConfig : dirname(dirOrConfig);
    saveOptions(options, options.srcDir);

    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: `Config file created with default options. Do you want to proceed with these options?`,
        default: false,
      },
    ]);
    if (!proceed) {
      logger.info('Please update the config file and restart the application.');
      await inquirer.prompt([{ type: 'input', name: 'exit', message: 'Press Enter to exit...' }]);
      process.exit(0);
    }
  }

  const options = loadOptions(dirOrConfig);

  const ffmpegVersion = await getFFMpegVersion(options.ffmpegPath);
  logger.info(`FFmpeg version: ${ffmpegVersion}`);

  return options;
}

export default bootstrap;
