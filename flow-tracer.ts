import { signal, computed, effect } from './index';
import { Dependency, Subscriber, DirtyLevels, System, Link } from './lib/system';

// ======== 通用调试工具 ========

// 创建一个调试ID生成器
let nextId = 1;
function generateId(prefix: string): string {
  return `${prefix}_${nextId++}`;
}

// 调试日志级别
enum LogLevel {
  INFO = 'INFO',
  DEBUG = 'DEBUG',
  TRACE = 'TRACE'
}

// 当前日志级别
let currentLogLevel = LogLevel.INFO;

// 设置日志级别
function setLogLevel(level: LogLevel) {
  currentLogLevel = level;
}

// 带有颜色和缩进的日志函数
function log(level: LogLevel, message: string, indentLevel = 0, color?: string) {
  // 检查日志级别
  if (
    (level === LogLevel.DEBUG && currentLogLevel === LogLevel.TRACE) ||
    (level === LogLevel.INFO && (currentLogLevel === LogLevel.DEBUG || currentLogLevel === LogLevel.TRACE)) ||
    level === currentLogLevel
  ) {
    const indent = '  '.repeat(indentLevel);
    console.log(`${indent}${message}`);
  }
}

// ======== 拦截器和跟踪器 ========

// 依赖收集跟踪器
function traceLink() {
  const originalLink = Dependency.link;
  Dependency.link = function(dep: Dependency) {
    const activeSub = System.activeSub;
    const traceId = generateId('link');
    
    // 开始追踪
    log(LogLevel.INFO, `🔄 [${traceId}] 开始依赖收集...`, 0);
    
    if (!activeSub) {
      log(LogLevel.DEBUG, `❌ [${traceId}] 没有活跃订阅者，依赖收集取消`, 1);
      return originalLink.call(this, dep);
    }
    
    const depId = (dep as any).id || 'unknown-dep';
    const subId = (activeSub as any).id || 'unknown-sub';
    
    log(LogLevel.DEBUG, `🔍 [${traceId}] 依赖(${depId}) <-- 订阅者(${subId})`, 1);
    
    // 检查版本号
    const subVersion = activeSub.versionOrDirtyLevel;
    log(LogLevel.TRACE, `📊 [${traceId}] 当前订阅者版本: ${subVersion}`, 2);
    log(LogLevel.TRACE, `📊 [${traceId}] 依赖记录的版本: ${dep.subVersion}`, 2);
    
    if (dep.subVersion === subVersion) {
      log(LogLevel.DEBUG, `⏭️ [${traceId}] 版本号匹配，跳过重复链接`, 1);
      return originalLink.call(this, dep);
    }
    
    log(LogLevel.DEBUG, `✅ [${traceId}] 版本号不匹配，建立新链接`, 1);
    dep.subVersion = subVersion;
    
    // 调用原始函数并返回结果
    const result = originalLink.call(this, dep);
    
    // 完成追踪
    log(LogLevel.INFO, `✓ [${traceId}] 依赖收集完成`, 0);
    return result;
  };
}

// 更新传播跟踪器
function tracePropagate() {
  const originalPropagate = Dependency.propagate;
  Dependency.propagate = function(dep: Dependency) {
    const traceId = generateId('propagate');
    const depId = (dep as any).id || 'unknown-dep';
    
    // 开始追踪
    log(LogLevel.INFO, `🔄 [${traceId}] 开始更新传播 从 ${depId}...`, 0);
    
    // 创建一个拷贝，用于后面的遍历
    const subsSnapshot: Array<{ sub: Subscriber, dirtyLevel: number | DirtyLevels }> = [];
    let currentSub = dep.subs;
    while (currentSub) {
      subsSnapshot.push({
        sub: currentSub.sub,
        dirtyLevel: currentSub.sub.versionOrDirtyLevel
      });
      currentSub = currentSub.nextSub;
    }
    
    log(LogLevel.DEBUG, `📡 [${traceId}] 准备向 ${subsSnapshot.length} 个订阅者传播更新`, 1);
    
    // 调用原始函数传播更新
    originalPropagate.call(this, dep);
    
    // 报告每个订阅者的状态变化
    for (const { sub, dirtyLevel } of subsSnapshot) {
      const subId = (sub as any).id || 'unknown-sub';
      const oldStateStr = dirtyLevelToString(dirtyLevel);
      const newStateStr = dirtyLevelToString(sub.versionOrDirtyLevel);
      
      log(LogLevel.DEBUG, `🏷️ [${traceId}] 订阅者 ${subId}: ${oldStateStr} -> ${newStateStr}`, 1);
      
      // 检查是否为 Effect 并且是否进入了队列
      if ('notify' in sub) {
        const isQueued = checkIfEffectQueued(sub);
        if (isQueued) {
          log(LogLevel.DEBUG, `🕒 [${traceId}] 副作用 ${subId} 已入队，等待执行`, 2);
        }
      }
    }
    
    // 完成追踪
    log(LogLevel.INFO, `✓ [${traceId}] 更新传播完成`, 0);
  };
}

// 跟踪 Effect run 和 notify
function traceEffect() {
  const originalRun = Effect.prototype.run;
  const originalNotify = Effect.prototype.notify;
  
  Effect.prototype.run = function() {
    const traceId = generateId('effect_run');
    const effectId = (this as any).id || 'unknown-effect';
    
    log(LogLevel.INFO, `🔄 [${traceId}] 开始执行副作用 ${effectId}...`, 0);
    
    // 调用原始方法
    const result = originalRun.call(this);
    
    log(LogLevel.INFO, `✓ [${traceId}] 副作用执行完成`, 0);
    return result;
  };
  
  Effect.prototype.notify = function() {
    const traceId = generateId('effect_notify');
    const effectId = (this as any).id || 'unknown-effect';
    
    log(LogLevel.INFO, `🔔 [${traceId}] 通知副作用 ${effectId}...`, 0);
    log(LogLevel.DEBUG, `🏷️ [${traceId}] 当前状态: ${dirtyLevelToString(this.versionOrDirtyLevel)}`, 1);
    
    // MaybeDirty 状态处理
    if (this.versionOrDirtyLevel === DirtyLevels.MaybeDirty) {
      log(LogLevel.DEBUG, `🧹 [${traceId}] 处理 MaybeDirty 状态...`, 1);
    }
    
    // 调用原始方法
    const result = originalNotify.call(this);
    
    log(LogLevel.INFO, `✓ [${traceId}] 通知处理完成`, 0);
    return result;
  };
}

// 跟踪 Computed get 和 run
function traceComputed() {
  const originalGet = Computed.prototype.get;
  const originalRun = Computed.prototype.run;
  
  Computed.prototype.get = function() {
    const traceId = generateId('computed_get');
    const computedId = (this as any).id || 'unknown-computed';
    
    log(LogLevel.INFO, `🔄 [${traceId}] 获取计算值 ${computedId}...`, 0);
    log(LogLevel.DEBUG, `🏷️ [${traceId}] 当前状态: ${dirtyLevelToString(this.versionOrDirtyLevel)}`, 1);
    
    // 检查是否需要重新计算
    if (this.versionOrDirtyLevel !== DirtyLevels.NotDirty) {
      log(LogLevel.DEBUG, `🧮 [${traceId}] 需要重新计算`, 1);
    } else {
      log(LogLevel.DEBUG, `📋 [${traceId}] 使用缓存值`, 1);
    }
    
    // 调用原始方法
    const result = originalGet.call(this);
    
    log(LogLevel.INFO, `✓ [${traceId}] 获取计算值完成`, 0);
    return result;
  };
  
  Computed.prototype.run = function() {
    const traceId = generateId('computed_run');
    const computedId = (this as any).id || 'unknown-computed';
    
    log(LogLevel.INFO, `🔄 [${traceId}] 重新计算 ${computedId}...`, 0);
    
    // 调用原始方法
    const result = originalRun.call(this);
    
    log(LogLevel.DEBUG, `📊 [${traceId}] 新状态: ${dirtyLevelToString(this.versionOrDirtyLevel)}`, 1);
    log(LogLevel.INFO, `✓ [${traceId}] 计算完成`, 0);
    return result;
  };
}

// 跟踪批处理
function traceBatch() {
  const originalStartBatch = System.startBatch;
  const originalEndBatch = System.endBatch;
  
  System.startBatch = function() {
    const traceId = generateId('batch_start');
    
    log(LogLevel.INFO, `🔄 [${traceId}] 开始批处理...`, 0);
    log(LogLevel.DEBUG, `📊 [${traceId}] 当前批处理深度: ${System.batchDepth}`, 1);
    
    // 调用原始方法
    originalStartBatch.call(this);
    
    log(LogLevel.DEBUG, `📊 [${traceId}] 新批处理深度: ${System.batchDepth}`, 1);
    log(LogLevel.INFO, `✓ [${traceId}] 批处理开始完成`, 0);
  };
  
  System.endBatch = function() {
    const traceId = generateId('batch_end');
    
    log(LogLevel.INFO, `🔄 [${traceId}] 结束批处理...`, 0);
    log(LogLevel.DEBUG, `📊 [${traceId}] 当前批处理深度: ${System.batchDepth}`, 1);
    
    const hasQueuedEffects = System.queuedEffects !== undefined;
    if (hasQueuedEffects) {
      log(LogLevel.DEBUG, `📋 [${traceId}] 有待执行的副作用`, 1);
    }
    
    // 调用原始方法
    originalEndBatch.call(this);
    
    log(LogLevel.DEBUG, `📊 [${traceId}] 新批处理深度: ${System.batchDepth}`, 1);
    log(LogLevel.INFO, `✓ [${traceId}] 批处理结束完成`, 0);
  };
}

// ======== 辅助函数 ========

// 辅助函数：将脏状态转换为字符串
function dirtyLevelToString(level: number | DirtyLevels): string {
  if (level === DirtyLevels.NotDirty) return 'NotDirty (干净)';
  if (level === DirtyLevels.MaybeDirty) return 'MaybeDirty (可能脏)';
  if (level === DirtyLevels.Dirty) return 'Dirty (脏)';
  return `Version(${level})`;
}

// 检查 Effect 是否在队列中
function checkIfEffectQueued(effect: any): boolean {
  let current = System.queuedEffects;
  while (current) {
    if (current === effect) return true;
    current = current.nextNotify;
  }
  return false;
}

// 获取 Effect 类引用
const Effect = effect(() => {}).constructor as any;
// 获取 Computed 类引用
const Computed = computed(() => 0).constructor as any;

// ======== 安装所有跟踪器 ========
function installAllTracers() {
  traceLink();
  tracePropagate();
  traceEffect();
  traceComputed();
  traceBatch();
  
  log(LogLevel.INFO, '✅ 所有跟踪器已安装', 0);
}

// ======== 使用示例 ========

// 设置日志级别
setLogLevel(LogLevel.INFO); // 可以设置为 DEBUG 或 TRACE 获取更详细信息

// 安装跟踪器
installAllTracers();

console.log('\n========== 开始演示 ==========\n');

// 创建信号
const count = signal(0);
const multiplier = signal(2);
(count as any).id = 'count';
(multiplier as any).id = 'multiplier';

// 创建计算属性
const doubled = computed(() => count.get() * 2);
const result = computed(() => doubled.get() * multiplier.get());
(doubled as any).id = 'doubled';
(result as any).id = 'result';

// 创建副作用
const logger = effect(() => {
  console.log(`结果为: ${result.get()}`);
});
(logger as any).id = 'logger';

console.log('\n========== 更新演示 ==========\n');

// 单个更新
console.log('\n--- 更新 count ---');
count.set(1);

console.log('\n--- 更新 multiplier ---');
multiplier.set(3);

// 批处理更新
console.log('\n--- 批处理更新 ---');
System.startBatch();
count.set(5);
multiplier.set(10);
System.endBatch();

console.log('\n========== 演示结束 ==========\n'); 