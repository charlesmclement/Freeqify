import {loadPrivateEnvironment} from '../../../scripts/private-environment.mjs';
import {projectRoot} from './config.js';
/** Process > external private config > optional repository .env, all validated. */
export function loadEnvironment(){loadPrivateEnvironment(projectRoot);}
