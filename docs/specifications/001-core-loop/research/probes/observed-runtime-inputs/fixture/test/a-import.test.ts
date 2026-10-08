import { test, expect } from 'vitest';
import { add } from '../src/lib';
test('import only', () => expect(add(1, 2)).toBe(3));
