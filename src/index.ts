import logger from "./logger";
import inquirer from "inquirer";
import bootstrap from "./bootstrap";
import { displayMainMenu } from "./menu";
import Encoder from "./encoder";
import { deleteDatabase, getDbPath, initializeDatabase } from "./db";
import { PausableTask } from "./pausableTask";
import Scanner from "./scanner";

const main = async () => {
  let { db, options } = await bootstrap();

  logger.info(`Working directory${options.deep ? ' (and subdirectories)' : ''}: ${options.srcDir}`);
  logger.info(`Output directory: ${options.dstDir}`);

  if (options.filterBy?.codec && options.force) {
    logger.notice('You have force enabled in the config file, so ffprobing will be skipped and codec filtering will only be performed on the files cached from previous runs (if there were any). If this is unintentional, edit the config and reload.');
  }

  let exit = false;
  while (!exit) {
    const action = await displayMainMenu();

    switch (action) {
      case 'scan':
        const scanner = new Scanner(db, options);
        const scannerTask = new PausableTask(scanner);
        const result = await scannerTask.runTask(options.srcDir);
        logger.info(result.report());
        logger.debug(`Success:\n${result.success.map(file => file.path).join('\n')}`);
        logger.debug(`Skipped:\n${result.skipped.join('\n')}`);
        break;
      case 'process':
        const encoder = new Encoder(options);

        const encoderTask = new PausableTask(encoder);
        await encoderTask.runTask([]);
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
