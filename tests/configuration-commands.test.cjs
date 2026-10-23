const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const ui = {};
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  return name === 'vscode' ? { window: ui } : originalLoad.call(this, name, ...args);
};
const { addCustomObject, manageCustomObjects, selectStatusBarItems } = require('../src/ui/configuration-commands.ts');
Module._load = originalLoad;
function settings(objects = [], visible = ['claude']) {
  return {
    objects, visible,
    getCustomObjects() { return this.objects; },
    getStatusBarItems() { return this.visible; },
    async saveCustomObjects(value) { this.objects = value; },
    async saveStatusBarItems(value) { this.visible = value; },
  };
}

test('add command saves a named typed object, marks the key input private and enables visibility', async () => {
  const config = settings();
  const inputs = ['游卡', 'https://relay.example/', 'test-key'];
  ui.showInputBox = async options => {
    const value = inputs.shift();
    if (options.title === 'API Key') assert.equal(options.password, true);
    assert.equal(options.validateInput(value), undefined);
    return value;
  };
  ui.showQuickPick = async items => items.find(item => item.label === 'newapi');
  ui.showInformationMessage = async () => {};
  await addCustomObject(config);
  assert.equal(config.objects.length, 1);
  assert.equal(config.objects[0].type, 'newapi');
  assert.equal(config.objects[0].name, '游卡');
  assert.equal(config.objects[0].baseUrl, 'https://relay.example');
  assert.equal(config.objects[0].apiKey, 'test-key');
  assert.deepEqual(config.visible, ['claude', config.objects[0].id]);
});

test('cancelling the add flow preserves configuration', async () => {
  const config = settings();
  ui.showInputBox = async () => undefined;
  await addCustomObject(config);
  assert.deepEqual(config.objects, []);
  assert.deepEqual(config.visible, ['claude']);
});

test('visibility picker expands wildcard and can hide every object', async () => {
  const config = settings([
    { id: 'one', name: 'One', type: 'newapi', enabled: true },
    { id: 'two', name: 'Two', type: 'sub2api', enabled: false },
  ], ['claude', 'custom:*']);
  ui.showQuickPick = async (items, options) => {
    assert.equal(options.canPickMany, true);
    assert.deepEqual(items.map(item => item.id), ['claude', 'openai', 'one']);
    assert.equal(items[2].picked, true);
    return [];
  };
  await selectStatusBarItems(config);
  assert.deepEqual(config.visible, []);
});

test('deleting an object requires confirmation and removes its explicit visibility entry', async () => {
  const config = settings([{ id: 'one', name: 'One', type: 'newapi', enabled: true }], ['claude', 'one']);
  ui.showQuickPick = async items => items.find(item => item.id === 'delete') ?? items[0];
  ui.showWarningMessage = async () => undefined;
  await manageCustomObjects(config);
  assert.equal(config.objects.length, 1);
  ui.showWarningMessage = async () => '删除';
  await manageCustomObjects(config);
  assert.deepEqual(config.objects, []);
  assert.deepEqual(config.visible, ['claude']);
});
