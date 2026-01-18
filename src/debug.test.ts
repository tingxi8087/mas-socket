import 'module-alias/register';
import { test, expect, describe } from 'bun:test';

describe('debug test', () => {
  test('main', async () => {
    expect(true).toBe(true);
  });
});
