import { signal, computed, effect } from './index';
import { Dependency, Subscriber, Link, System } from './lib/system';

// 用于存储对象的人类可读名称
const nodeNames = new Map<any, string>();

// 为对象注册名称
function nameNode(node: any, name: string) {
  nodeNames.set(node, name);
  return node;
}

// 为 Link 对象创建人类可读的表示
function visualizeLink(link: Link | undefined, depth = 0): string {
  if (!link) return 'null';
  
  const indent = '  '.repeat(depth);
  const depName = nodeNames.get(link.dep) || 'unnamed-dep';
  const subName = nodeNames.get(link.sub) || 'unnamed-sub';
  
  let result = `${indent}Link {\n`;
  result += `${indent}  dep: ${depName},\n`;
  result += `${indent}  sub: ${subName},\n`;
  
  // 递归可视化 nextSub (同一个依赖的其他订阅者)
  result += `${indent}  nextSub: `;
  if (link.nextSub) {
    result += '\n' + visualizeLink(link.nextSub, depth + 2);
  } else {
    result += 'null,\n';
  }
  
  // 递归可视化 nextDep (同一个订阅者的其他依赖)
  result += `${indent}  nextDep: `;
  if (link.nextDep) {
    result += '\n' + visualizeLink(link.nextDep, depth + 2);
  } else {
    result += 'null\n';
  }
  
  result += `${indent}}`;
  return result;
}

// 可视化依赖的所有订阅者
function visualizeDependencySubscribers(dep: Dependency & { name?: string }) {
  const depName = nodeNames.get(dep) || dep.name || 'unnamed-dependency';
  console.log(`\n===== 依赖 ${depName} 的订阅者链表 =====`);
  console.log(visualizeLink(dep.subs));
  console.log('===============================\n');
}

// 可视化订阅者的所有依赖
function visualizeSubscriberDependencies(sub: Subscriber & { name?: string }) {
  const subName = nodeNames.get(sub) || sub.name || 'unnamed-subscriber';
  console.log(`\n===== 订阅者 ${subName} 的依赖链表 =====`);
  console.log(visualizeLink(sub.deps));
  console.log('===============================\n');
}

// ===== 实际使用示例 =====
console.log('创建响应式图...');

// 创建命名的信号
const count = nameNode(signal(0), 'count');
const factor = nameNode(signal(2), 'factor');

// 创建命名的计算属性
const doubled = nameNode(
  computed(() => count.get() * 2),
  'doubled'
);

const multiplied = nameNode(
  computed(() => doubled.get() * factor.get()),
  'multiplied'
);

// 创建命名的副作用
const logger = nameNode(
  effect(() => {
    console.log(`Current value: ${multiplied.get()}`);
  }),
  'logger'
);

// 打印初始链接状态
console.log('\n初始链接状态:');
visualizeDependencySubscribers(count);
visualizeSubscriberDependencies(doubled);

// 更新并打印更新后的链接状态
console.log('\n更新 count 后:');
count.set(1);
visualizeDependencySubscribers(count);
visualizeSubscriberDependencies(doubled);

// 更新 factor 并观察变化
console.log('\n更新 factor 后:');
factor.set(3);
visualizeDependencySubscribers(factor);
visualizeSubscriberDependencies(multiplied);

// 打印 logger 的所有依赖（应该只有 multiplied）
console.log('\nlogger 的依赖:');
visualizeSubscriberDependencies(logger); 