import { expect } from 'chai';
import { Sandbox } from '../../src/utils/sandbox.js';

describe('Sandbox', () => {
  describe('run()', () => {
    it('evaluates and returns simple arithmetic expressions', () => {
      const result = Sandbox.run('1 + 1');
      expect(result).to.equal(2);
    });

    it('returns string values', () => {
      const result = Sandbox.run('"hello" + " world"');
      expect(result).to.equal('hello world');
    });

    it('exposes context variables to the script', () => {
      const result = Sandbox.run('x * 3', { x: 7 });
      expect(result).to.equal(21);
    });

    it('exposes multiple context variables', () => {
      const result = Sandbox.run('a + b', { a: 10, b: 5 });
      expect(result).to.equal(15);
    });

    it('exposes object context variables', () => {
      const result = Sandbox.run('data.value * 2', { data: { value: 6 } });
      expect(result).to.equal(12);
    });

    it('returns undefined for variable declarations with no explicit return', () => {
      const result = Sandbox.run('let a = 42;');
      expect(result).to.be.undefined;
    });

    it('returns the last expression value', () => {
      const result = Sandbox.run('const x = 5; x * x');
      expect(result).to.equal(25);
    });

    it('can call Array methods on context data', () => {
      const result = Sandbox.run('items.map(x => x * 2)', { items: [1, 2, 3] });
      expect(result).to.deep.equal([2, 4, 6]);
    });

    it('throws on syntax errors', () => {
      expect(() => Sandbox.run('function( { {')).to.throw();
    });

    it('throws on runtime errors with the error message', () => {
      expect(() => Sandbox.run('throw new Error("test runtime error")')).to.throw('test runtime error');
    });

    it('throws when accessing undefined variables', () => {
      expect(() => Sandbox.run('undeclaredVariable.property')).to.throw();
    });

    it('times out on infinite loops (within 5 seconds)', function () {
      this.timeout(8000);
      expect(() => Sandbox.run('while (true) {}')).to.throw();
    });

    it('runs with empty context when no context provided', () => {
      const result = Sandbox.run('2 ** 10');
      expect(result).to.equal(1024);
    });
  });
});
