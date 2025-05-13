import { signal, computed, effect } from './index';
import { Dependency, Subscriber, Link, System } from './lib/system';
import * as fs from 'fs';
import * as path from 'path';

// ==========================================================================
// 链表快照跟踪系统 - 用于深度调试依赖关系链表的变化
// ==========================================================================

interface LinkSnapshot {
  id: string;
  depName: string;
  subName: string;
  nextSubId: string | null;
  nextDepId: string | null;
  timestamp: number;
}

interface NodeSnapshot {
  id: string;
  name: string;
  type: 'dependency' | 'subscriber' | 'both';
  depsHeadId: string | null;
  depsTailId: string | null;
  subsHeadId: string | null;
  subsTailId: string | null;
  timestamp: number;
}

interface SnapshotEvent {
  type: 'link_created' | 'link_removed' | 'node_updated' | 'operation';
  timestamp: number;
  data: any;
  description: string;
}

// 全局状态
const snapshotState = {
  links: new Map<Link, LinkSnapshot>(),
  nodes: new Map<any, NodeSnapshot>(),
  events: [] as SnapshotEvent[],
  linkIdCounter: 1,
  nodeIdCounter: 1,
  operationDepth: 0,
  enabled: true,
  outputDir: './debug-snapshots',
  currentOperation: ''
};

// 初始化输出目录
if (!fs.existsSync(snapshotState.outputDir)) {
  fs.mkdirSync(snapshotState.outputDir, { recursive: true });
}

// 节点名称映射
const nodeNames = new Map<any, string>();

// 注册节点名称
export function nameNode(node: any, name: string) {
  nodeNames.set(node, name);
  return node;
}

// 获取节点名称
function getNodeName(node: any): string {
  const name = nodeNames.get(node);
  if (name) return name;
  
  // 尝试从构造函数名称推断
  if (node && node.constructor) {
    const type = node.constructor.name;
    return `${type}_${getNodeId(node)}`;
  }
  
  return `Unknown_${getNodeId(node)}`;
}

// 获取节点ID
function getNodeId(node: any): string {
  let snapshot = snapshotState.nodes.get(node);
  if (!snapshot) {
    const id = `node_${snapshotState.nodeIdCounter++}`;
    const type = determineNodeType(node);
    
    snapshot = {
      id,
      name: getNodeName(node),
      type,
      depsHeadId: null,
      depsTailId: null,
      subsHeadId: null,
      subsTailId: null,
      timestamp: Date.now()
    };
    
    snapshotState.nodes.set(node, snapshot);
  }
  
  return snapshot.id;
}

// 确定节点类型
function determineNodeType(node: any): 'dependency' | 'subscriber' | 'both' {
  const hasDeps = 'deps' in node && 'depsTail' in node;
  const hasSubs = 'subs' in node && 'subsTail' in node;
  
  if (hasDeps && hasSubs) return 'both';
  if (hasDeps) return 'subscriber';
  if (hasSubs) return 'dependency';
  
  // 默认情况，不应该发生
  console.warn('Node has neither deps nor subs properties', node);
  return 'dependency';
}

// 获取链接ID
function getLinkId(link: Link): string {
  let snapshot = snapshotState.links.get(link);
  if (!snapshot) {
    const id = `link_${snapshotState.linkIdCounter++}`;
    snapshot = {
      id,
      depName: getNodeName(link.dep),
      subName: getNodeName(link.sub),
      nextSubId: null,
      nextDepId: null,
      timestamp: Date.now()
    };
    
    snapshotState.links.set(link, snapshot);
  }
  
  return snapshot.id;
}

// 更新链接快照
function updateLinkSnapshot(link: Link) {
  if (!snapshotState.enabled) return;
  
  const snapshot = snapshotState.links.get(link);
  if (!snapshot) return;
  
  snapshot.nextSubId = link.nextSub ? getLinkId(link.nextSub) : null;
  snapshot.nextDepId = link.nextDep ? getLinkId(link.nextDep) : null;
  snapshot.timestamp = Date.now();
}

// 更新节点快照
function updateNodeSnapshot(node: any) {
  if (!snapshotState.enabled) return;
  
  const snapshot = snapshotState.nodes.get(node);
  if (!snapshot) return;
  
  if ('deps' in node) {
    snapshot.depsHeadId = node.deps ? getLinkId(node.deps) : null;
  }
  
  if ('depsTail' in node) {
    snapshot.depsTailId = node.depsTail ? getLinkId(node.depsTail) : null;
  }
  
  if ('subs' in node) {
    snapshot.subsHeadId = node.subs ? getLinkId(node.subs) : null;
  }
  
  if ('subsTail' in node) {
    snapshot.subsTailId = node.subsTail ? getLinkId(node.subsTail) : null;
  }
  
  snapshot.timestamp = Date.now();
  
  // 记录节点更新事件
  recordEvent('node_updated', snapshot, `Node ${snapshot.name} updated`);
}

// 记录事件
function recordEvent(type: SnapshotEvent['type'], data: any, description: string) {
  if (!snapshotState.enabled) return;
  
  const event: SnapshotEvent = {
    type,
    timestamp: Date.now(),
    data,
    description
  };
  
  snapshotState.events.push(event);
}

// ==========================================================================
// 拦截原有的 Link 和 Dependency 功能来跟踪变化
// ==========================================================================

// 拦截 Link.get 函数
function interceptLinkGet() {
  const originalGet = Link.get;
  Link.get = function(dep: Dependency, sub: Subscriber): Link {
    const link = originalGet.call(this, dep, sub);
    
    const linkId = getLinkId(link);
    recordEvent('link_created', { linkId, depName: getNodeName(dep), subName: getNodeName(sub) }, 
      `Created link: ${getNodeName(sub)} depends on ${getNodeName(dep)}`);
    
    updateLinkSnapshot(link);
    return link;
  };
}

// 拦截 Link.release 函数
function interceptLinkRelease() {
  const originalRelease = Link.release;
  Link.release = function(link: Link) {
    const linkId = getLinkId(link);
    recordEvent('link_removed', { linkId, depName: getNodeName(link.dep), subName: getNodeName(link.sub) }, 
      `Removed link: ${getNodeName(link.sub)} no longer depends on ${getNodeName(link.dep)}`);
    
    originalRelease.call(this, link);
  };
}

// 拦截 Dependency.link 函数
function interceptDependencyLink() {
  const originalLink = Dependency.link;
  Dependency.link = function(dep: Dependency) {
    startOperation(`Dependency.link(${getNodeName(dep)})`);
    
    const result = originalLink.call(this, dep);
    
    if (System.activeSub) {
      updateNodeSnapshot(System.activeSub);
    }
    updateNodeSnapshot(dep);
    
    endOperation();
    return result;
  };
}

// 拦截 Dependency.propagate 函数
function interceptDependencyPropagate() {
  const originalPropagate = Dependency.propagate;
  Dependency.propagate = function(dep: Dependency) {
    startOperation(`Dependency.propagate(${getNodeName(dep)})`);
    
    // 获取传播前的快照
    takeSnapshot(`before_propagate_${getNodeName(dep)}`);
    
    const result = originalPropagate.call(this, dep);
    
    // 获取传播后的快照
    takeSnapshot(`after_propagate_${getNodeName(dep)}`);
    
    endOperation();
    return result;
  };
}

// 拦截 Subscriber.startTrack 函数
function interceptSubscriberStartTrack() {
  const originalStartTrack = Subscriber.startTrack;
  Subscriber.startTrack = function(sub: Subscriber) {
    startOperation(`Subscriber.startTrack(${getNodeName(sub)})`);
    
    const result = originalStartTrack.call(this, sub);
    updateNodeSnapshot(sub);
    
    endOperation();
    return result;
  };
}

// 拦截 Subscriber.endTrack 函数
function interceptSubscriberEndTrack() {
  const originalEndTrack = Subscriber.endTrack;
  Subscriber.endTrack = function(sub: Subscriber, lastActiveSub: Subscriber | undefined) {
    startOperation(`Subscriber.endTrack(${getNodeName(sub)})`);
    
    const result = originalEndTrack.call(this, sub, lastActiveSub);
    updateNodeSnapshot(sub);
    
    if (lastActiveSub) {
      updateNodeSnapshot(lastActiveSub);
    }
    
    endOperation();
    return result;
  };
}

// ==========================================================================
// 操作跟踪与快照
// ==========================================================================

function startOperation(name: string) {
  if (!snapshotState.enabled) return;
  
  if (snapshotState.operationDepth === 0) {
    snapshotState.currentOperation = name;
  }
  
  snapshotState.operationDepth++;
  recordEvent('operation', { name, started: true, depth: snapshotState.operationDepth }, 
    `Started operation: ${name} (depth: ${snapshotState.operationDepth})`);
}

function endOperation() {
  if (!snapshotState.enabled) return;
  
  const depth = snapshotState.operationDepth;
  snapshotState.operationDepth--;
  
  recordEvent('operation', { name: snapshotState.currentOperation, ended: true, depth }, 
    `Ended operation: ${snapshotState.currentOperation} (depth: ${depth})`);
  
  if (snapshotState.operationDepth === 0) {
    snapshotState.currentOperation = '';
  }
}

// 创建完整快照
export function takeSnapshot(label: string) {
  if (!snapshotState.enabled) return;
  
  const timestamp = Date.now();
  const filename = `${timestamp}_${label.replace(/[^a-z0-9_-]/gi, '_')}.json`;
  const filePath = path.join(snapshotState.outputDir, filename);
  
  const snapshot = {
    timestamp,
    label,
    links: Array.from(snapshotState.links.values()),
    nodes: Array.from(snapshotState.nodes.values()),
    events: snapshotState.events.slice(), // 创建副本
  };
  
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
  console.log(`Snapshot saved to ${filePath}`);
  
  // 清除事件列表，避免过多的内存使用
  snapshotState.events = [];
}

// 启用/禁用快照
export function enableSnapshots(enabled: boolean) {
  snapshotState.enabled = enabled;
}

// 安装所有拦截器
export function installLinkTracker() {
  interceptLinkGet();
  interceptLinkRelease();
  interceptDependencyLink();
  interceptDependencyPropagate();
  interceptSubscriberStartTrack();
  interceptSubscriberEndTrack();
  
  console.log('Link tracker installed. Snapshots will be saved to', snapshotState.outputDir);
}

// ==========================================================================
// 可视化工具
// ==========================================================================

// 生成链表可视化的 DOT 格式图
export function generateDependencyGraph(label: string) {
  const timestamp = Date.now();
  const filename = `${timestamp}_graph_${label.replace(/[^a-z0-9_-]/gi, '_')}`;
  const dotFilePath = path.join(snapshotState.outputDir, `${filename}.dot`);
  
  let dot = 'digraph DependencyGraph {\n';
  dot += '  rankdir=LR;\n';
  dot += '  node [shape=box, style=filled, fillcolor=lightblue];\n';
  
  // 添加节点
  for (const node of snapshotState.nodes.values()) {
    let color = 'lightblue';
    if (node.type === 'dependency') color = 'lightgreen';
    else if (node.type === 'subscriber') color = 'lightyellow';
    else if (node.type === 'both') color = 'lightpink';
    
    dot += `  "${node.id}" [label="${node.name}", fillcolor=${color}];\n`;
  }
  
  // 添加链接
  for (const link of snapshotState.links.values()) {
    // 找到对应的节点
    let depNode = null;
    let subNode = null;
    
    for (const node of snapshotState.nodes.values()) {
      if (node.name === link.depName) depNode = node;
      if (node.name === link.subName) subNode = node;
    }
    
    if (depNode && subNode) {
      dot += `  "${subNode.id}" -> "${depNode.id}" [label="${link.id}"];\n`;
    }
  }
  
  dot += '}\n';
  
  fs.writeFileSync(dotFilePath, dot);
  console.log(`DOT graph saved to ${dotFilePath}`);
  
  return dotFilePath;
}

// 生成依赖图的 HTML 可视化页面
export function generateHtmlVisualization(label: string) {
  const timestamp = Date.now();
  const filename = `${timestamp}_viz_${label.replace(/[^a-z0-9_-]/gi, '_')}.html`;
  const htmlFilePath = path.join(snapshotState.outputDir, filename);
  
  let html = `
<!DOCTYPE html>
<html>
<head>
  <title>Dependency Graph - ${label}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
    .node { 
      border: 1px solid #ccc; 
      border-radius: 4px; 
      padding: 10px; 
      margin-bottom: 10px; 
      background-color: #f9f9f9;
    }
    .link {
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 8px;
      margin: 5px 0 5px 20px;
      background-color: #f0f0f0;
    }
    .dependency { background-color: #e0ffe0; }
    .subscriber { background-color: #fffce0; }
    .both { background-color: #ffe0e0; }
    .events {
      border: 1px solid #ccc;
      border-radius: 4px;
      padding: 10px;
      margin-top: 20px;
      background-color: #f5f5f5;
      max-height: 300px;
      overflow-y: auto;
    }
    .event {
      border-bottom: 1px solid #eee;
      padding: 5px 0;
    }
  </style>
</head>
<body>
  <h1>Dependency Graph - ${label}</h1>
  <h2>Nodes</h2>
  <div class="nodes">
`;

  // 添加节点
  for (const node of snapshotState.nodes.values()) {
    html += `
    <div class="node ${node.type}" id="${node.id}">
      <h3>${node.name} (${node.type})</h3>
      <div>
        <strong>Deps Head:</strong> ${node.depsHeadId || 'null'}<br>
        <strong>Deps Tail:</strong> ${node.depsTailId || 'null'}<br>
        <strong>Subs Head:</strong> ${node.subsHeadId || 'null'}<br>
        <strong>Subs Tail:</strong> ${node.subsTailId || 'null'}<br>
      </div>
    </div>
`;
  }

  html += `
  </div>
  
  <h2>Links</h2>
  <div class="links">
`;

  // 添加链接
  for (const link of snapshotState.links.values()) {
    html += `
    <div class="link" id="${link.id}">
      <strong>${link.id}:</strong> ${link.subName} depends on ${link.depName}<br>
      <strong>Next Sub:</strong> ${link.nextSubId || 'null'}<br>
      <strong>Next Dep:</strong> ${link.nextDepId || 'null'}<br>
    </div>
`;
  }

  html += `
  </div>
  
  <h2>Events</h2>
  <div class="events">
`;

  // 添加事件
  for (const event of snapshotState.events) {
    html += `
    <div class="event">
      <strong>${new Date(event.timestamp).toISOString()}</strong> - ${event.type}: ${event.description}
    </div>
`;
  }

  html += `
  </div>
</body>
</html>
`;

  fs.writeFileSync(htmlFilePath, html);
  console.log(`HTML visualization saved to ${htmlFilePath}`);
  
  return htmlFilePath;
}

// ==========================================================================
// 示例使用
// ==========================================================================

// 安装跟踪器
installLinkTracker();

// 创建信号节点并命名
const count = nameNode(signal(0), 'count');
const factor = nameNode(signal(2), 'factor');

console.log('Creating computed nodes...');

// 创建计算节点并命名
const doubled = nameNode(
  computed(() => count.get() * 2),
  'doubled'
);

const multiplied = nameNode(
  computed(() => doubled.get() * factor.get()),
  'multiplied'
);

// 获取初始快照
takeSnapshot('initial_state');
generateDependencyGraph('initial_state');
generateHtmlVisualization('initial_state');

console.log('Creating effect...');

// 创建副作用并命名
const logger = nameNode(
  effect(() => {
    console.log(`Current value: ${multiplied.get()}`);
  }),
  'logger'
);

// 获取创建 effect 后的快照
takeSnapshot('after_effect_creation');
generateDependencyGraph('after_effect_creation');
generateHtmlVisualization('after_effect_creation');

console.log('Updating count...');

// 更新 count 值并记录快照
count.set(1);
takeSnapshot('after_count_update');
generateDependencyGraph('after_count_update');
generateHtmlVisualization('after_count_update');

console.log('Updating factor...');

// 更新 factor 值并记录快照
factor.set(3);
takeSnapshot('after_factor_update');
generateDependencyGraph('after_factor_update');
generateHtmlVisualization('after_factor_update');

console.log('Testing batch updates...');

// 测试批处理更新
System.startBatch();
takeSnapshot('batch_start');
count.set(5);
takeSnapshot('batch_after_count_update');
factor.set(10);
takeSnapshot('batch_before_end');
System.endBatch();
takeSnapshot('batch_end');

// 生成最终的可视化
generateDependencyGraph('final_state');
generateHtmlVisualization('final_state');

console.log('Debug completed. Check the debug-snapshots directory for output files.'); 