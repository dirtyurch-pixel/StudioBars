import { LOCAL } from './api'

/** Where things are kept, in words: the phone version keeps everything in the browser on this device. */
export const HERE = LOCAL ? 'this device' : 'this computer'
