'use strict';

// Collection rules are shared by the simulation, guide and catalogue. Reading
// progress never awards equipment; successful game actions persist acquisitions.
const MODULES = [
  { id: 'packer', name: '装箱臂', description: '额外生产15%合同货物，原有零售产出保留。', condition: '完成第7单' },
  { id: 'coating', name: '糖衣机', description: '糖衣加工速度提高150%，礼盒更快出货。', condition: '完成第7单' },
  { id: 'pressure', name: '蓄压罐', description: '满锅自动增产25%；也可选择手动储压。', condition: '完成第8单' },
  { id: 'feeder', name: '自动送料器', description: '每锅自动追加一次添料，保留3次手动额度。', condition: '换代至多头机' },
  { id: 'reclaimer', name: '热能回收器', description: '自然蓄能速度提高10%，更频繁自动出锅。', condition: '多头机且出锅15次，或完成第13单' },
  { id: 'inspector', name: '质检台', description: '新合同基础奖金提高5%，货款单独结算。', condition: '三类合同各交付1次，或完成第16单' }
];
const finite = n => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : 0;
function equipmentProgress(state = {}) {
  const f = state.factory || {}, owned = Array.isArray(f.owned) ? f.owned : [];
  const orders = finite(state.orderIndex), machine = finite(state.machine), bursts = finite(state.bursts);
  const count = ['cinema', 'gift', 'festival'].filter(k => finite(f.contractCounts && f.contractCounts[k]) > 0).length;
  return MODULES.map(item => {
    let progress, progressText, earned;
    if (item.id === 'packer' || item.id === 'coating' || item.id === 'pressure') {
      const target = item.id === 'pressure' ? 8 : 7;
      earned = machine >= 2 && orders >= target; progress = Math.min(orders / target, 1);
      progressText = '主线交付 ' + Math.min(orders, target) + '/' + target + ' 单';
    } else if (item.id === 'feeder') {
      earned = machine >= 3; progress = Math.min(machine / 3, 1);
      progressText = earned ? '多头机已落成' : '下一目标：换代至多头机';
    } else if (item.id === 'reclaimer') {
      earned = machine >= 2 && (machine >= 3 && bursts >= 15 || orders >= 13);
      progress = Math.max(Math.min(machine >= 3 ? bursts / 15 : 0, 1), Math.min(orders / 13, 1));
      progressText = '出锅 ' + Math.min(bursts, 15) + '/15 · 主线 ' + Math.min(orders, 13) + '/13';
    } else {
      earned = machine >= 2 && (count === 3 || orders >= 16);
      progress = Math.max(count / 3, Math.min(orders / 16, 1));
      progressText = '客户 ' + count + '/3 类 · 主线 ' + Math.min(orders, 16) + '/16';
    }
    const has = owned.includes(item.id);
    return { ...item, earned, owned: has, equipped: has, unlocked: has, available: false,
      progress: has ? 1 : progress, progressText: has ? '已获得 · 永久生效' : progressText };
  });
}
module.exports = { MODULES, equipmentProgress };
