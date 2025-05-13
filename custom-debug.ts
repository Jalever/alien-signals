import { signal, computed, effect } from './index';
import { Dependency, Subscriber, Link, System } from './lib/system';

/**
 * 自定义调试器 - 专注于链表指针追踪
 * 
 * 这个工具设计用于详细调试链表指针的变化，包括：
 * - deps、depsTail：订阅者的依赖链表头尾指针
 * - subs、subsTail：依赖项的订阅者链表头尾指针 
 * - subVersion：依赖项记录的版本号
 */

// 为节点添加易于识别的标签
const nodeLabels = new Map<any, string>();

function labelNode(node: any, label: string): any {
  nodeLabels.set(node, label);
  return node;
}

function getNodeLabel(node: any): string {
  return nodeLabels.get(node) || `匿名节点(${node?.constructor?.name || '未知类型'})`;
}

// 打印带有缩进的信息
function log(message: string, indentLevel: number = 0) {
  const indent = '  '.repeat(indentLevel);
  console.log(`${indent}${message}`);
}

// 链表节点可读展示
function formatLink(link: Link | undefined, indent: number = 0): string {
  if (!link) return 'null';
  
  const depLabel = getNodeLabel(link.dep);
  const subLabel = getNodeLabel(link.sub);
  
  return `Link { dep: ${depLabel}, sub: ${subLabel} }`;
}

// 链表可读展示
function formatLinkList(head: Link | undefined, indent: number = 0): string {
  if (!head) return 'null';
  
  let result = '';
  let current = head;
  let i = 0;
  
  while (current) {
    if (i > 0) result += '\n' + '  '.repeat(indent);
    result += `[${i}]: ${formatLink(current)}`;
    
    // 防止循环引用导致无限循环
    if (i > 100) {
      result += '\n' + '  '.repeat(indent) + '... (可能存在循环引用)';
      break;
    }
    
    current = current.nextSub || current.nextDep;
    i++;
  }
  
  return result;
}

/**
 * 跟踪依赖关系的详细状态
 */
function inspectDependency(dep: Dependency & { currentValue?: any, id?: string }, label?: string) {
  const nodeLabel = label || getNodeLabel(dep);
  
  log(`\n===== 依赖状态: ${nodeLabel} =====`);
  
  if ('currentValue' in dep) {
    log(`值: ${JSON.stringify(dep.currentValue)}`, 1);
  }
  
  log(`subVersion: ${dep.subVersion}`, 1);
  log(`subs (订阅者链表头): ${formatLink(dep.subs)}`, 1);
  log(`subsTail (订阅者链表尾): ${formatLink(dep.subsTail)}`, 1);
  
  if (dep.subs) {
    log(`订阅者链表内容:`, 1);
    log(formatLinkList(dep.subs, 2), 2);
  }
  
  // 如果是 Signal，打印更多细节
  if ('currentValue' in dep) {
    log(`\n当前值: ${JSON.stringify(dep.currentValue)}`, 1);
  }
  
  // 如果同时也是 Subscriber (例如 Computed)
  if ('deps' in dep) {
    log(`\n作为订阅者的属性:`, 1);
    log(`versionOrDirtyLevel: ${(dep as any).versionOrDirtyLevel}`, 2);
    log(`deps (依赖链表头): ${formatLink((dep as any).deps)}`, 2);
    log(`depsTail (依赖链表尾): ${formatLink((dep as any).depsTail)}`, 2);
    
    if ((dep as any).deps) {
      log(`依赖链表内容:`, 2);
      log(formatLinkList((dep as any).deps, 3), 3);
    }
  }
  
  log(`=======${nodeLabel} 状态结束=======\n`);
}

/**
 * 跟踪订阅者的详细状态
 */
function inspectSubscriber(sub: Subscriber & { id?: string }, label?: string) {
  const nodeLabel = label || getNodeLabel(sub);
  
  log(`\n===== 订阅者状态: ${nodeLabel} =====`);
  log(`versionOrDirtyLevel: ${sub.versionOrDirtyLevel}`, 1);
  log(`deps (依赖链表头): ${formatLink(sub.deps)}`, 1);
  log(`depsTail (依赖链表尾): ${formatLink(sub.depsTail)}`, 1);
  
  if (sub.deps) {
    log(`依赖链表内容:`, 1);
    log(formatLinkList(sub.deps, 2), 2);
  }
  
  // 如果同时也是 Dependency (例如 Computed)
  if ('subs' in sub) {
    log(`\n作为依赖的属性:`, 1);
    log(`subVersion: ${(sub as any).subVersion}`, 2);
    log(`subs (订阅者链表头): ${formatLink((sub as any).subs)}`, 2);
    log(`subsTail (订阅者链表尾): ${formatLink((sub as any).subsTail)}`, 2);
    
    if ((sub as any).subs) {
      log(`订阅者链表内容:`, 2);
      log(formatLinkList((sub as any).subs, 3), 3);
    }
  }
  
  log(`=======${nodeLabel} 状态结束=======\n`);
}

/**
 * 监控链表指针的变化
 * 通过重写 setters 来跟踪节点指针变化
 */
function monitorPointerChanges(obj: any, label: string) {
  // 记录初始状态
  const initialState = {
    deps: obj.deps,
    depsTail: obj.depsTail,
    subs: obj.subs,
    subsTail: obj.subsTail,
    subVersion: obj.subVersion,
    versionOrDirtyLevel: obj.versionOrDirtyLevel
  };
  
  // 为每个指针定义 getter 和 setter
  const pointers = ['deps', 'depsTail', 'subs', 'subsTail'];
  
  pointers.forEach(pointer => {
    if (pointer in obj) {
      const propDescriptor = Object.getOwnPropertyDescriptor(obj, pointer);
      if (propDescriptor && propDescriptor.writable) {
        let originalValue = obj[pointer];
        
        Object.defineProperty(obj, pointer, {
          get() {
            return originalValue;
          },
          set(newValue) {
            const oldValue = originalValue;
            originalValue = newValue;
            
            // 记录变化
            log(`\n🔄 [${label}] ${pointer} 变化:`);
            log(`旧值: ${formatLink(oldValue)}`, 1);
            log(`新值: ${formatLink(newValue)}`, 1);
            
            // 打印调用栈 (获取关键帧)
            const stack = new Error().stack?.split('\n').slice(2, 6).join('\n') || '';
            log(`调用位置:\n${stack}`, 1);
          },
          enumerable: true,
          configurable: true
        });
      }
    }
  });
  
  // 监控版本号和脏状态
  const versionProps = ['subVersion', 'versionOrDirtyLevel'];
  
  versionProps.forEach(prop => {
    if (prop in obj) {
      const propDescriptor = Object.getOwnPropertyDescriptor(obj, prop);
      if (propDescriptor && propDescriptor.writable) {
        let originalValue = obj[prop];
        
        Object.defineProperty(obj, prop, {
          get() {
            return originalValue;
          },
          set(newValue) {
            const oldValue = originalValue;
            originalValue = newValue;
            
            // 记录变化
            log(`\n🔢 [${label}] ${prop} 变化: ${oldValue} -> ${newValue}`);
            
            // 打印调用栈 (获取关键帧)
            const stack = new Error().stack?.split('\n').slice(2, 6).join('\n') || '';
            log(`调用位置:\n${stack}`, 1);
          },
          enumerable: true,
          configurable: true
        });
      }
    }
  });
  
  return obj;
}

/**
 * 拦截链表操作的核心函数
 */
function interceptLinkOperations() {
  // 拦截 Link.get 创建新链接
  const originalLinkGet = Link.get;
  Link.get = function(dep: Dependency, sub: Subscriber) {
    const depLabel = getNodeLabel(dep);
    const subLabel = getNodeLabel(sub);
    
    log(`\n➕ 创建链接: ${subLabel} <- ${depLabel}`);
    const link = originalLinkGet.call(this, dep, sub);
    log(`创建的链接: ${formatLink(link)}`, 1);
    
    return link;
  };
  
  // 拦截 Link.release 删除链接
  const originalLinkRelease = Link.release;
  Link.release = function(link: Link) {
    const depLabel = getNodeLabel(link.dep);
    const subLabel = getNodeLabel(link.sub);
    
    log(`\n➖ 删除链接: ${subLabel} <- ${depLabel}`);
    log(`删除的链接: ${formatLink(link)}`, 1);
    
    return originalLinkRelease.call(this, link);
  };
  
  // 拦截依赖收集过程
  const originalDependencyLink = Dependency.link;
  Dependency.link = function(dep: Dependency) {
    const depLabel = getNodeLabel(dep);
    const subLabel = System.activeSub ? getNodeLabel(System.activeSub) : '无活跃订阅者';
    
    log(`\n🔗 依赖收集: ${subLabel} 收集依赖 ${depLabel}`);
    
    if (System.activeSub) {
      log(`活跃订阅者版本: ${System.activeSub.versionOrDirtyLevel}`, 1);
    }
    log(`依赖当前版本: ${dep.subVersion}`, 1);
    
    const result = originalDependencyLink.call(this, dep);
    
    // 检查版本号是否已更新
    log(`依赖新版本: ${dep.subVersion}`, 1);
    log(`链接结果: ${result ? '已链接' : '未链接'}`, 1);
    
    return result;
  };
  
  // 拦截更新传播过程
  const originalDependencyPropagate = Dependency.propagate;
  Dependency.propagate = function(dep: Dependency) {
    const depLabel = getNodeLabel(dep);
    
    log(`\n📢 更新传播: 从 ${depLabel} 开始`);
    
    // 记录传播前状态
    if (dep.subs) {
      log(`订阅者链表 (传播前):`, 1);
      log(formatLinkList(dep.subs, 2), 2);
    } else {
      log(`该依赖没有订阅者`, 1);
    }
    
    const result = originalDependencyPropagate.call(this, dep);
    
    log(`更新传播完成: ${depLabel}`, 1);
    
    return result;
  };
}

/**
 * 创建带跟踪功能的响应式对象
 */
function createTrackedSignal<T>(value: T, label: string) {
  const sig = signal(value);
  labelNode(sig, label);
  monitorPointerChanges(sig, label);
  return sig;
}

function createTrackedComputed<T>(fn: () => T, label: string) {
  const comp = computed(fn);
  labelNode(comp, label);
  monitorPointerChanges(comp, label);
  return comp;
}

function createTrackedEffect(fn: () => void, label: string) {
  const eff = effect(fn);
  labelNode(eff, label);
  monitorPointerChanges(eff, label);
  return eff;
}

// 安装拦截器
interceptLinkOperations();

// ====== 示例用法 ======
log('开始调试测试...');

// 创建跟踪信号
const count = createTrackedSignal(0, 'count');
const factor = createTrackedSignal(2, 'factor');

// 创建跟踪计算属性
const doubled = createTrackedComputed(() => count.get() * 2, 'doubled');
const result = createTrackedComputed(() => doubled.get() * factor.get(), 'result');

// 检查初始状态
inspectDependency(count);
inspectSubscriber(doubled);

// 创建效果
log('\n创建效果...');
const logger = createTrackedEffect(() => {
  console.log(`计算结果: ${result.get()}`);
}, 'logger');

// 更新值并观察变化
log('\n更新 count...');
count.set(1);
inspectDependency(count);
inspectSubscriber(doubled);

log('\n更新 factor...');
factor.set(3);
inspectDependency(factor);
inspectSubscriber(result);

// 测试批处理
log('\n批处理测试...');
System.startBatch();
count.set(5);
factor.set(10);
inspectDependency(count, 'count (批处理中)');
System.endBatch();
inspectDependency(count, 'count (批处理后)');

log('\n调试测试完成!'); 