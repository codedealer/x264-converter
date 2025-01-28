import Ajv, { JSONSchemaType } from 'ajv';
import { Options } from './options';
import logger from "./logger";

const ajv = new Ajv();

const optionsSchema: JSONSchemaType<Options> = {
  type: 'object',
  properties: {
    srcDir: { type: 'string', nullable: false },
    dstDir: { type: 'string', nullable: true },
    deleteOriginal: { type: 'boolean' },
    preserveAttributes: { type: 'boolean' },
    careful: { type: 'boolean' },
    deep: { type: 'number' },
    ffmpegPath: { type: 'string', nullable: true },
    skipProbe: { type: 'boolean' },
    force: { type: 'boolean', nullable: true },
    videoOptions: {
      type: 'object',
      properties: {
        ffmpegCommand: { type: 'string' },
        outputContainer: { type: 'string', nullable: true },
      },
      required: ['ffmpegCommand'],
    },
    filterBy: {
      type: 'object',
      properties: {
        extension: { type: 'string', nullable: true },
        codec: { type: 'string', nullable: true },
      },
      nullable: true,
    },
  },
  required: ['srcDir', 'deleteOriginal', 'preserveAttributes', 'careful', 'deep', 'skipProbe', 'videoOptions'],
  additionalProperties: false,
};

const validateOptions = (data: unknown): data is Options => {
  const validate = ajv.compile(optionsSchema);
  if (validate(data)) {
    return true;
  } else {
    logger.error(validate.errors);
    return false;
  }
};

export { validateOptions };
