import logger from "./logger";
import inquirer from "inquirer";
import bootstrap from "./bootstrap";
import { displayMainMenu } from "./menu";
import Encoder from "./encoder";
import { readdirSync } from "node:fs";
import { join } from "path";
import { deleteDatabase, getDbPath, initializeDatabase } from "./db";
import { PausableTask } from "./pausableTask";
import Scanner from "./scanner";

const main = async () => {
  let { db, options } = await bootstrap();

  logger.info(`Working directory${options.deep ? ' (and subdirectories)' : ''}: ${options.srcDir}`);
  logger.info(`Output directory: ${options.dstDir}`);

  let exit = false;
  while (!exit) {
    const action = await displayMainMenu();

    switch (action) {
      case 'scan':
        const scanner = new Scanner(db, options);
        const scannerTask = new PausableTask(scanner);
        const unprocessedFiles = await scannerTask.runTask(options.srcDir);
        logger.debug(`Unprocessed: \n${unprocessedFiles.map(f => f.path).join('\n')}`);
        break;
      case 'process':
        const encoder = new Encoder(options);
        const mockQueue = readdirSync(options.srcDir).filter(file => file.endsWith('.mp4')).map(file => join(options.srcDir, file));

        const encoderTask = new PausableTask(encoder);
        await encoderTask.runTask(mockQueue);
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
