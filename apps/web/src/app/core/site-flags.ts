/**
 * Switches for parts of the site that are on or off for the time being. Change the value,
 * then merge and deploy.
 */

/**
 * The "Starting up the server… This takes up to a minute" bar shown while the free hosting
 * wakes the API. Off for now (it looked unpolished in demos). The quiet retries behind it
 * stay on either way, so pages still finish loading once the server is up.
 */
export const SHOW_WAKE_BANNER = false;
