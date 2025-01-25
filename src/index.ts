import logger from "./logger";
import inquirer from "inquirer";
import bootstrap from "./bootstrap";
import { displayMainMenu } from "./menu";
import Encoder from "./encoder";
import { deleteDatabase, getDbPath, initializeDatabase } from "./db";
import { PausableTask } from "./pausableTask";
import Scanner from "./scanner";
import { Options } from "./options";

const checkForceState = (options: Options) => {
  if (options.force) {
    logger.warn('Force mode enabled, ffprobing will be skipped.');
    if (options.filterBy?.codec) {
      logger.warn('You have codec filter set in the config. Codec filtering will only be performed on the files cached from previous runs (if there were any). If this is unintentional, edit the config and reload.');
    }
  } else {
    logger.info('Force mode disabled, ffprobing will be performed.');
  }
}

const main = async () => {
  let { db, options } = await bootstrap();

  logger.info(`Working directory${options.deep ? ' (and subdirectories)' : ''}: ${options.srcDir}`);
  logger.info(`Output directory: ${options.dstDir}`);

  checkForceState(options);

  let exit = false;
  while (!exit) {
    const action = await displayMainMenu();

    switch (action) {
      case 'process':
        const scanner = new Scanner(db, options);
        const scannerTask = new PausableTask(scanner);
        const scanResult = await scannerTask.runTask(options.srcDir);

        if (scanResult.totalQueueLength === 0) break;

        logger.info(scanResult.report());
        if (process.env.DEBUG) {
          logger.debug(`Success:\n${scanResult.success.map(file => file.path).join('\n')}`);
          logger.debug(`Skipped:\n${scanResult.skipped.join('\n')}`);
        }

        if (scanResult.success.length < 1) {
          logger.info('No files to process');
          break;
        }

        const encoder = new Encoder(options);
        const encoderTask = new PausableTask(encoder);
        const encodeResult = await encoderTask.runTask(scanResult.success);
        logger.info(encodeResult.report());
        if (process.env.DEBUG) {
          logger.debug(`Success:\n${encodeResult.success.map(file => file.path).join('\n')}`);
          logger.debug(`Skipped:\n${encodeResult.skipped.join('\n')}`);
        }

        break;
      case 'toggleForce':
        options.force = !options.force;
        checkForceState(options);
        break;
      case 'drop':
        // confirm dialog
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: 'Are you sure you want to delete the database?',
            default: false,
          },
        ]);
        if (confirm) {
          db.close();
          deleteDatabase(getDbPath());
          logger.info('Database deleted');
          db = initializeDatabase(getDbPath());
          logger.info('Database re-initialized');
        }
        break;
      case 'quit':
        logger.info('Quitting the app...');
        exit = true;
        break;
      default:
        throw new Error(`Invalid action: ${action}`);
    }
  }
}

main().catch(err => {
  logger.error(err);
  inquirer
    .prompt([{ type: 'input', name: 'exit', message: 'Press Enter to exit...' }])
    .then(() => process.exit(1))
  ;
});
