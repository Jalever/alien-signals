import { signal, computed, effect } from './index';

// 调试函数: 包装signal以便打印依赖收集和更新过程
function debugSignal<T>(name: string, initialValue: T) {
  const sig = signal(initialValue);
  
  // 保存原始的get和set方法
  const originalGet = sig.get.bind(sig);
  const originalSet = sig.set.bind(sig);
  
  // 重写get方法以便追踪依赖收集
  sig.get = function() {
    console.log(`[依赖收集] Signal "${name}" 被读取，值为:`, originalGet());
    return originalGet();
  };
  
  // 重写set方法以便追踪派发更新
  sig.set = function(value: T) {
    console.log(`[派发更新] Signal "${name}" 从 ${originalGet()} 更新为 ${value}`);
    originalSet(value);
    console.log(`[更新完成] Signal "${name}" 当前值为 ${originalGet()}`);
  };
  
  return sig;
}

// 调试函数: 包装computed以便打印依赖收集和更新过程
function debugComputed<T>(name: string, fn: () => T) {
  const comp = computed(fn);
  
  // 保存原始的get方法
  const originalGet = comp.get.bind(comp);
  
  // 重写get方法以便追踪依赖收集和计算
  comp.get = function() {
    console.log(`[计算] Computed "${name}" 被读取，开始计算...`);
    const value = originalGet();
    console.log(`[计算完成] Computed "${name}" 计算结果为:`, value);
    return value;
  };
  
  return comp;
}

// 调试函数: 包装effect以便打印运行过程
function debugEffect(name: string, fn: () => void) {
  console.log(`[创建] Effect "${name}" 被创建`);
  return effect(() => {
    console.log(`[运行] Effect "${name}" 开始执行...`);
    fn();
    console.log(`[运行完成] Effect "${name}" 执行完毕`);
  });
}

// ============ 开始调试示例 ============
console.log('=========== 初始化阶段 ===========');

// 创建信号
const counter = debugSignal('counter', 0);
// const multiplier = debugSignal('multiplier', 2);

// 创建计算属性
const doubled = debugComputed('doubled', () => counter.get() * 2);
// const complex = debugComputed('complex', () => doubled.get() * multiplier.get());

// 创建副作用
const effectA = debugEffect('counter-effect', () => {
  console.log(`Counter is: ${counter.get()}`);
});

// const effectB = debugEffect('complex-effect', () => {
//   console.log(`Complex value is: ${complex.get()}`);
// });

// ============ 更新阶段 ============
console.log('\n=========== 更新阶段 ===========');
console.log('\n--- 更新 counter ---');
counter.set(1);

// console.log('\n--- 更新 multiplier ---');
// multiplier.set(3);

console.log('\n--- 连续更新 counter ---');
counter.set(5);
counter.set(10);

// 展示自定义批处理(batching)
console.log('\n=========== 批处理更新 ===========');
import { System } from './lib/system';

console.log('\n--- 批处理两个更新 ---');
System.startBatch();
counter.set(20);
// multiplier.set(4);
System.endBatch(); 