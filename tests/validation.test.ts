import { describe, expect, it } from 'vitest'

import { object, requiredText, optionalText, text, errorMessage } from '../src/validation.js'

describe('src/validation.ts — shared validation utilities', () => {
  describe('object()', () => {
    it('accepts a plain object', () => {
      expect(object({ a: 1 }, 'test')).toEqual({ a: 1 })
    })

    it('rejects null', () => {
      expect(() => object(null, 'test')).toThrow('test must be an object')
    })

    it('rejects an array', () => {
      expect(() => object([], 'test')).toThrow('test must be an object')
    })

    it('rejects a string', () => {
      expect(() => object('hello', 'test')).toThrow('test must be an object')
    })

    it('rejects a number', () => {
      expect(() => object(42, 'test')).toThrow('test must be an object')
    })

    it('rejects undefined', () => {
      expect(() => object(undefined, 'test')).toThrow('test must be an object')
    })
  })

  describe('requiredText()', () => {
    it('accepts a non-empty string', () => {
      expect(requiredText('hello', 'name')).toBe('hello')
    })

    it('trims the value', () => {
      expect(requiredText('  spaced  ', 'name')).toBe('spaced')
    })

    it('rejects an empty string', () => {
      expect(() => requiredText('', 'name')).toThrow('name is required')
    })

    it('rejects whitespace-only string', () => {
      expect(() => requiredText('   ', 'name')).toThrow('name is required')
    })

    it('rejects a number', () => {
      expect(() => requiredText(42, 'name')).toThrow('name is required')
    })

    it('rejects undefined', () => {
      expect(() => requiredText(undefined, 'name')).toThrow('name is required')
    })

    it('rejects null', () => {
      expect(() => requiredText(null, 'name')).toThrow('name is required')
    })
  })

  describe('optionalText()', () => {
    it('returns empty string for undefined', () => {
      expect(optionalText(undefined, 'opt')).toBe('')
    })

    it('accepts a non-empty string', () => {
      expect(optionalText('hello', 'opt')).toBe('hello')
    })

    it('trims the value', () => {
      expect(optionalText('  hello  ', 'opt')).toBe('hello')
    })

    it('accepts an empty string', () => {
      expect(optionalText('', 'opt')).toBe('')
    })

    it('rejects a number', () => {
      expect(() => optionalText(42, 'opt')).toThrow('opt must be a string')
    })

    it('rejects null', () => {
      expect(() => optionalText(null, 'opt')).toThrow('opt must be a string')
    })
  })

  describe('text()', () => {
    it('accepts a non-empty string', () => {
      expect(text('hello', 'txt')).toBe('hello')
    })

    it('trims the value', () => {
      expect(text('  hello  ', 'txt')).toBe('hello')
    })

    it('rejects an empty string', () => {
      expect(() => text('', 'txt')).toThrow('txt must be a non-empty string')
    })

    it('rejects whitespace-only string', () => {
      expect(() => text('   ', 'txt')).toThrow('txt must be a non-empty string')
    })

    it('rejects a number', () => {
      expect(() => text(42, 'txt')).toThrow('txt must be a non-empty string')
    })

    it('rejects undefined', () => {
      expect(() => text(undefined, 'txt')).toThrow('txt must be a non-empty string')
    })

    it('rejects null', () => {
      expect(() => text(null, 'txt')).toThrow('txt must be a non-empty string')
    })
  })

  describe('errorMessage()', () => {
    it('returns Error.message from an Error', () => {
      expect(errorMessage(new Error('boom'))).toBe('boom')
    })

    it('returns a string unchanged', () => {
      expect(errorMessage('raw error')).toBe('raw error')
    })

    it('coerces a number to string', () => {
      expect(errorMessage(42)).toBe('42')
    })

    it('returns "[object Object]" for a plain object', () => {
      expect(errorMessage({ a: 1 })).toBe('[object Object]')
    })

    it('returns "null" for null', () => {
      expect(errorMessage(null)).toBe('null')
    })

    it('returns "undefined" for undefined', () => {
      expect(errorMessage(undefined)).toBe('undefined')
    })
  })
})