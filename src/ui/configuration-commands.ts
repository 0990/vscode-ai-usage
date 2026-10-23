import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { ConfigManager } from '../config';
import type { CustomObjectConfig, CustomObjectType } from '../types';

interface IdentifiedItem extends vscode.QuickPickItem {
  id: string;
}

function validBaseUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname ||
        url.username || url.password || url.search || url.hash) {
      return '请输入不含账号、查询参数和片段的 HTTP/HTTPS 地址';
    }
    return undefined;
  } catch {
    return '请输入有效的 HTTP/HTTPS 地址';
  }
}

async function promptObject(
  existing: CustomObjectConfig | undefined,
  objects: CustomObjectConfig[]
): Promise<CustomObjectConfig | undefined> {
  const name = await vscode.window.showInputBox({
    title: existing ? '编辑自定义对象' : '新增自定义对象',
    prompt: '显示名称',
    value: existing?.name,
    ignoreFocusOut: true,
    validateInput: value => {
      const trimmed = value.trim();
      if (!trimmed) { return '请填写名称'; }
      if (objects.some(item => item.id !== existing?.id && item.name === trimmed)) {
        return '名称不能重复';
      }
      return undefined;
    },
  });
  if (name === undefined) { return undefined; }

  const typeItem = await vscode.window.showQuickPick([
    { label: 'sub2api', description: 'GET /v1/usage' },
    { label: 'newapi', description: 'OpenAI billing 兼容接口' },
  ], {
    title: '选择接口类型',
    placeHolder: existing?.type,
    ignoreFocusOut: true,
  });
  if (!typeItem) { return undefined; }

  const baseUrl = await vscode.window.showInputBox({
    title: 'Base URL',
    prompt: '可填写站点根地址或带 /v1 的地址',
    value: existing?.baseUrl,
    ignoreFocusOut: true,
    validateInput: value => validBaseUrl(value.trim()),
  });
  if (baseUrl === undefined) { return undefined; }

  const apiKey = await vscode.window.showInputBox({
    title: 'API Key',
    prompt: existing ? '留空表示保留原 API Key' : '仅随余额请求发送，不写入日志',
    password: true,
    ignoreFocusOut: true,
    validateInput: value => (!existing && !value.trim()) || /[\r\n]/.test(value)
      ? '请填写有效的 API Key' : undefined,
  });
  if (apiKey === undefined) { return undefined; }

  return {
    id: existing?.id ?? `custom:${randomUUID()}`,
    name: name.trim(),
    type: typeItem.label as CustomObjectType,
    baseUrl: baseUrl.trim().replace(/\/$/, ''),
    apiKey: apiKey.trim() || existing?.apiKey || '',
    enabled: existing?.enabled ?? true,
  };
}

export async function addCustomObject(config: ConfigManager): Promise<void> {
  const objects = config.getCustomObjects();
  const created = await promptObject(undefined, objects);
  if (!created) { return; }
  await config.saveCustomObjects([...objects, created]);
  const visible = config.getStatusBarItems();
  if (!visible.includes('custom:*') && !visible.includes(created.id)) {
    await config.saveStatusBarItems([...visible, created.id]);
  }
  void vscode.window.showInformationMessage(`已新增自定义对象：${created.name}`);
}

export async function manageCustomObjects(config: ConfigManager): Promise<void> {
  const objects = config.getCustomObjects();
  if (objects.length === 0) {
    const add = await vscode.window.showInformationMessage(
      '尚未配置自定义对象。',
      '立即新增'
    );
    if (add === '立即新增') { await addCustomObject(config); }
    return;
  }
  const selected = await vscode.window.showQuickPick(
    objects.map(object => ({
      label: object.name,
      description: `${object.type} · ${object.enabled ? '已启用' : '已停用'}`,
      detail: object.baseUrl,
      id: object.id,
    })),
    { title: '管理自定义对象', placeHolder: '选择要编辑的对象', ignoreFocusOut: true }
  );
  if (!selected) { return; }
  const current = objects.find(object => object.id === selected.id);
  if (!current) { return; }
  const action = await vscode.window.showQuickPick([
    { label: '$(edit) 编辑', id: 'edit' },
    { label: current.enabled ? '$(circle-slash) 停用' : '$(pass) 启用', id: 'toggle' },
    { label: '$(trash) 删除', id: 'delete' },
  ], { title: current.name, ignoreFocusOut: true });
  if (!action) { return; }

  if (action.id === 'edit') {
    const updated = await promptObject(current, objects);
    if (!updated) { return; }
    await config.saveCustomObjects(objects.map(object => object.id === current.id ? updated : object));
  } else if (action.id === 'toggle') {
    await config.saveCustomObjects(objects.map(object => object.id === current.id
      ? { ...object, enabled: !object.enabled } : object));
  } else {
    const confirmed = await vscode.window.showWarningMessage(
      `确定删除“${current.name}”吗？`,
      { modal: true },
      '删除'
    );
    if (confirmed !== '删除') { return; }
    await config.saveCustomObjects(objects.filter(object => object.id !== current.id));
    await config.saveStatusBarItems(config.getStatusBarItems().filter(id => id !== current.id));
  }
}

export async function selectStatusBarItems(config: ConfigManager): Promise<void> {
  const objects = config.getCustomObjects().filter(object => object.enabled);
  const current = new Set(config.getStatusBarItems());
  const items: IdentifiedItem[] = [
    { id: 'claude', label: 'Claude', picked: current.has('claude') },
    { id: 'openai', label: 'ChatGPT', picked: current.has('openai') },
    ...objects.map(object => ({
      id: object.id,
      label: object.name,
      description: object.type,
      picked: current.has('custom:*') || current.has(object.id),
    })),
  ];
  const selected = await vscode.window.showQuickPick(items, {
    title: '选择状态栏显示项',
    placeHolder: '可多选；未选择的对象仍会显示在详情页',
    canPickMany: true,
    ignoreFocusOut: true,
  });
  if (!selected) { return; }
  await config.saveStatusBarItems(selected.map(item => item.id));
}

export async function showConfigurationMenu(config: ConfigManager): Promise<void> {
  const action = await vscode.window.showQuickPick([
    { label: '$(list-selection) 选择状态栏显示项', id: 'status' },
    { label: '$(add) 新增自定义对象', id: 'add' },
    { label: '$(settings-gear) 编辑或删除自定义对象', id: 'manage' },
    { label: '$(json) 打开全部扩展设置', id: 'settings' },
  ], { title: 'AI Usage Tracker 设置', ignoreFocusOut: true });
  if (!action) { return; }
  if (action.id === 'status') { await selectStatusBarItems(config); }
  if (action.id === 'add') { await addCustomObject(config); }
  if (action.id === 'manage') { await manageCustomObjects(config); }
  if (action.id === 'settings') {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'aiUsageTracker');
  }
}
