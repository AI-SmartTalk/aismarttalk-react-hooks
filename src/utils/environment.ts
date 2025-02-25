/**
 * Check if code is running on the server (Node.js) or in the browser
 */
export const isServer = (): boolean => {
  return typeof window === 'undefined';
}; 