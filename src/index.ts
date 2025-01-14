import logger from "./logger";
import inquirer from "inquirer";
import bootstrap from "./bootstrap";
import { displayMainMenu } from "./menu";
import Encoder from "./encoder";
import KeypressListener from "./keypressListener";
import { readdirSync } from "node:fs";

const main = async () => {
  const options = await bootstrap();

  logger.info(`Working directory${options.deep ? ' (and subdirectories)' : ''}: ${options.srcDir}`);
  logger.info(`Output directory: ${options.dstDir}`);

  let exit = false;
  while (!exit) {
    const action = await displayMainMenu();

    switch (action) {
      case 'process':
        const encoder = new Encoder(options);
        const mockQueue = readdirSync(options.srcDir).filter(file => file.endsWith('.mp4'));

        if (process.stdin.isPaused()) {
          process.stdin.resume();
          logger.debug('Resuming stdin stream');
        }

        const listener = new KeypressListener();
        listener.on('p', () => encoder.requestStateChange('pause'));
        listener.on('q', () => encoder.requestStateChange('stop'));
        logger.info('Press "p" to pause, "q" to stop');

        try {
          await encoder.processQueue(mockQueue);
        } catch (e) {
          logger.error(e);
        } finally {
          listener.removeAllListeners();
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
