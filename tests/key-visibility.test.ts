import assert from 'node:assert/strict';
import test from 'node:test';
import { setKeyVisibility } from '../src/components/settings/keyVisibility.js';

const labels = { show: 'Show API key', hide: 'Hide API key' };

function harness(value = 'sk-secret-123') {
  const attributes: Record<string, string> = {};
  let valueWrites = 0;
  const input = {
    type: 'password',
    get value() {
      return value;
    },
    set value(_next: string) {
      valueWrites += 1;
    },
  };
  const toggle = {
    title: '',
    setAttribute(name: string, value: string) {
      attributes[name] = value;
    },
  };
  return { input, toggle, attributes, writes: () => valueWrites };
}

test('the key starts masked, toggles reliably, and leaves the value untouched', () => {
  const { input, toggle, attributes, writes } = harness();
  setKeyVisibility(input, toggle, false, labels);
  assert.equal(input.type, 'password');
  assert.equal(attributes['aria-pressed'], 'false');
  assert.equal(attributes['aria-label'], labels.show);
  assert.equal(toggle.title, labels.show);

  setKeyVisibility(input, toggle, false, labels);
  assert.equal(input.type, 'password');
  assert.equal(attributes['aria-pressed'], 'false');
  assert.equal(attributes['aria-label'], labels.show);

  setKeyVisibility(input, toggle, true, labels);
  assert.equal(input.type, 'text');
  assert.equal(attributes['aria-pressed'], 'true');
  assert.equal(attributes['aria-label'], labels.hide);
  assert.equal(toggle.title, labels.hide);

  setKeyVisibility(input, toggle, true, labels);
  assert.equal(input.type, 'text');
  assert.equal(attributes['aria-pressed'], 'true');
  assert.equal(attributes['aria-label'], labels.hide);
  assert.equal(input.value, 'sk-secret-123');
  assert.equal(writes(), 0);
});

test('hiding the key restores the masked state and show wording', () => {
  const { input, toggle, attributes, writes } = harness();
  setKeyVisibility(input, toggle, true, labels);
  setKeyVisibility(input, toggle, false, labels);
  assert.equal(input.type, 'password');
  assert.equal(attributes['aria-pressed'], 'false');
  assert.equal(attributes['aria-label'], labels.show);
  assert.equal(toggle.title, labels.show);
  assert.equal(input.value, 'sk-secret-123');
  assert.equal(writes(), 0);
});
