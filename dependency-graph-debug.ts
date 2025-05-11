import { signal, computed, effect } from './index';
import { Dependency, Subscriber, DirtyLevels, System, Link } from './lib/system';

// 为了跟踪依赖关系，我们需要重新定义一些映射来存储节点之间的关系
const nodeMap = new Map<any, string>();
const dependencyGraph: Record<string, string[]> = {};

// 全局依赖图可视化函数
function visualizeDependencyGraph() {
  console.log('\n===== 依赖图 =====');
  for (const [nodeId, deps] of Object.entries(dependencyGraph)) {
    console.log(`${nodeId} 依赖于: ${deps.join(', ') || '(无依赖)'}`);
  }
  console.log('==================\n');
}

// 注册一个节点到全局映射
function registerNode(node: any, name: string) {
  nodeMap.set(node, name);
  if (!dependencyGraph[name]) {
    dependencyGraph[name] = [];
  }
  return node;
}

// 原始的 Dependency.link 函数调用前的拦截器
const originalLink = Dependency.link;
Dependency.link = function(dep: Dependency) {
  // 获取当前活跃的订阅者和依赖的名称
  const activeSub = System.activeSub;
  if (!activeSub) return originalLink.call(this, dep);
  
  const depName = nodeMap.get(dep) || 'unknown-dep';
  const subName = nodeMap.get(activeSub) || 'unknown-sub';
  
  // 确保订阅者在依赖图中有记录
  if (!dependencyGraph[subName]) {
    dependencyGraph[subName] = [];
  }
  
  // 如果这是一个新的依赖关系，则更新依赖图
  if (!dependencyGraph[subName].includes(depName)) {
    console.log(`[依赖收集] 建立链接: ${subName} 现在依赖于 ${depName}`);
    dependencyGraph[subName].push(depName);
  }
  
  return originalLink.call(this, dep);
};

// 原始的 Dependency.propagate 函数调用前的拦截器
const originalPropagate = Dependency.propagate;
Dependency.propagate = function(dep: Dependency) {
  const depName = nodeMap.get(dep) || 'unknown-dep';
  console.log(`\n[派发更新] ${depName} 开始向下游传播更新...`);
  
  // 模拟传播过程中的脏标记传播
  let currentSubs = dep.subs;
  while (currentSubs) {
    const sub = currentSubs.sub;
    const subName = nodeMap.get(sub) || 'unknown-sub';
    
    // 获取更新前的脏状态
    const oldDirtyLevel = sub.versionOrDirtyLevel;
    const oldStateDesc = describeDirtyLevel(oldDirtyLevel);
    
    // 调用原始传播函数，更新脏状态
    originalPropagate.call(this, dep);
    
    // 获取更新后的脏状态
    const newDirtyLevel = sub.versionOrDirtyLevel;
    const newStateDesc = describeDirtyLevel(newDirtyLevel);
    
    console.log(`[派发更新] ${depName} -> ${subName}: 状态从 ${oldStateDesc} 变为 ${newStateDesc}`);
    
    // 由于原始函数已经执行了传播，这里我们不再继续模拟
    break;
  }
  
  return;
};

// 辅助函数：描述脏状态
function describeDirtyLevel(level: number | DirtyLevels): string {
  if (level === DirtyLevels.NotDirty) return 'NotDirty (干净)';
  if (level === DirtyLevels.MaybeDirty) return 'MaybeDirty (可能脏)';
  if (level === DirtyLevels.Dirty) return 'Dirty (脏)';
  return `Version(${level})`;
}

// 创建跟踪版本的 signal
function trackedSignal<T>(name: string, initialValue: T) {
  const sig = signal(initialValue);
  return registerNode(sig, `signal:${name}`);
}

// 创建跟踪版本的 computed
function trackedComputed<T>(name: string, fn: () => T) {
  const comp = computed(fn);
  return registerNode(comp, `computed:${name}`);
}

// 创建跟踪版本的 effect
function trackedEffect(name: string, fn: () => void) {
  const eff = effect(fn);
  return registerNode(eff, `effect:${name}`);
}

// ======== 使用跟踪功能构建一个示例 ========
console.log('======== 初始化依赖关系 ========');

// 创建原始信号
const count = trackedSignal('count', 0);
const factor = trackedSignal('factor', 2);

// 创建多层计算
const doubled = trackedComputed('doubled', () => count.get() * 2);
const factored = trackedComputed('factored', () => doubled.get() * factor.get());
const final = trackedComputed('final', () => `结果: ${factored.get()}`);

// 添加副作用
trackedEffect('logger', () => {
  console.log(`当前值: ${final.get()}`);
});

// 初始化时刷新一次依赖图
visualizeDependencyGraph();

// 更新值并观察传播
console.log('======== 更新测试 ========');
console.log('\n[更新] count.set(1)');
count.set(1);
visualizeDependencyGraph();

console.log('\n[更新] factor.set(3)');
factor.set(3);
visualizeDependencyGraph();

// 批处理测试
console.log('\n======== 批处理测试 ========');
System.startBatch();
console.log('[批处理开始]');
count.set(5);
factor.set(10);
console.log('[批处理结束]');
System.endBatch();
visualizeDependencyGraph(); 