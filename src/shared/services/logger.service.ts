import { Token } from 'typedi';
import { Logger } from '../interfaces/logger.interface';

export const LOGGER_TOKEN = new Token<Logger>('LOGGER');
