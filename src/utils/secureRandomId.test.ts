import { secureRandomId } from './secureRandomId';
it('uses Web Crypto without falling back to Math.random', () => {
  const random = jest.spyOn(Math, 'random').mockImplementation(() => { throw new Error('insecure'); });
  const crypto = jest.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(array => {
    (array as Uint8Array).fill(171); return array;
  });
  try { expect(secureRandomId()).toBe('ab'.repeat(32)); expect(crypto).toHaveBeenCalledTimes(1); }
  finally { crypto.mockRestore(); random.mockRestore(); }
});
it('fails closed when secure randomness is unavailable', () => {
  const crypto = jest.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => { throw new Error('unavailable'); });
  try { expect(() => secureRandomId()).toThrow('unavailable'); } finally { crypto.mockRestore(); }
});
