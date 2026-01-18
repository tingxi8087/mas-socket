import 'module-alias/register';
import { test, expect, describe } from 'bun:test';

describe('debug test', () => {
  test('main', async () => {
    await import('@/index');
    expect(true).toBe(true);
  });
});
