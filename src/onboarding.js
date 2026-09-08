'use strict';

// Progress unlocks the game; acknowledging a lesson only changes its visibility.
// Keep this module independent of core so simulation and presentation share rules.
const number = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
const upgrade = (state, key) => number(state.upgrades && state.upgrades[key]);
const { equipmentProgress } = require('./equipment');

function featureAccess(state = {}) {
  const legacy = !!(state.onboarding && state.onboarding.legacy === true);
  const machine = number(state.machine), orders = number(state.orderIndex), factory = state.factory || {};
  const active = factory.active && factory.active.kind;
  const owned = new Set(equipmentProgress(state).filter(item => item.owned).map(item => item.id));
  const established = orders > 0 || machine > 0;
  return {
    tapUpgrade: legacy || number(state.taps) >= 5 || number(state.totalProduced) >= 16 || ['tap', 'auto', 'value'].some(key => upgrade(state, key) > 0) || established,
    autoUpgrade: legacy || upgrade(state, 'tap') > 0 || upgrade(state, 'auto') > 0 || established,
    orders: legacy || upgrade(state, 'auto') > 0 || established,
    valueUpgrade: legacy || orders >= 1 || upgrade(state, 'value') > 0 || machine > 0,
    heat: legacy || upgrade(state, 'auto') > 0 || number(state.bursts) > 0,
    workshop: legacy || established,
    records: legacy || established,
    rewards: (legacy || orders >= 1) && number(state.playedSeconds) >= 90,
    brand: machine >= 1,
    pot: machine >= 2,
    contracts: machine >= 2 && (legacy || orders >= 6),
    modules: machine >= 2,
    gift: machine >= 2 && (legacy || orders >= 7 || active === 'gift'),
    festival: machine >= 2 && (legacy || orders >= 8 || active === 'festival'),
    pressure: owned.has('pressure'),
    feeder: owned.has('feeder'),
    reclaimer: owned.has('reclaimer'),
    inspector: owned.has('inspector'),
    bulk: machine >= 3,
    souvenirs: machine >= 5 && orders >= 20
  };
}

const LESSONS = [
  { id: 'production', title: '第一桶，从这里开始', benefit: '生产出的爆米花会自动出售，金币用来升级工厂。',
    instruction: '轻点机器投料；松开手后，锅也会慢慢自动生产。先点击 5 次，或等待累计生产 16 份。', action: 'tap', buttonLabel: '开始生产' },
  { id: 'tapUpgrade', title: '新功能：爆裂玉米', benefit: '升级玉米后，每次有效点击都能生产更多爆米花。',
    instruction: '攒够金币后，升级一次爆裂玉米。下一步会开放自动火力。', action: 'upgrade:tap', buttonLabel: '查看玉米升级',
    unlock: '点击 5 次或累计生产 16 份后，解锁爆裂玉米升级' },
  { id: 'autoUpgrade', title: '新功能：自动火力', benefit: '提高持续自动生产速度，松开手也能不断赚金币、推进订单。',
    instruction: '升级一次自动火力，让机器接班。产量和收入会随等级继续增长。', action: 'upgrade:auto', buttonLabel: '查看自动火力',
    unlock: '爆裂玉米升至 1 级后，解锁自动火力升级' },
  { id: 'orders', title: '新功能：订单装车', benefit: '完成客户目标后，装车可以领取一笔额外金币，用来加快升级。',
    instruction: '前 6 单按累计产量达标，装车不扣除累计产量。先完成街角第一桶，达标后领取奖励。', action: 'order', buttonLabel: '查看第一单',
    unlock: '自动火力升至 1 级后，解锁订单' },
  { id: 'valueUpgrade', title: '新功能：焦糖配方', benefit: '提高每份爆米花的售价，点击、自动生产和爆锅都能卖出更多金币。',
    instruction: '用首单奖励升级一次焦糖配方，再继续积累换代资金。', action: 'upgrade:value', buttonLabel: '查看焦糖配方',
    unlock: '完成第 1 张订单后，解锁焦糖配方' },
  { id: 'heat', title: '新功能：能量与免费爆锅', benefit: '点击和在线生产会蓄能，能量满格时免费产出一大锅爆米花。',
    instruction: '留意机器旁的能量进度，继续生产并等待满格；不用观看广告也能爆锅。', action: 'tap', buttonLabel: '继续蓄能',
    unlock: '自动火力升至 1 级后，解锁能量说明' },
  { id: 'workshop', title: '新功能：工坊与机器换代', benefit: '换代会提高生产能力，并逐步开放新的工厂玩法；已经买到的升级会保留。',
    instruction: '先完成 3 张订单，并攒够 3 万金币，换上电热锅。工坊会显示下一台机器的条件。', action: 'machine', buttonLabel: '查看换代条件',
    unlock: '完成第 1 张订单后，解锁工坊' },
  { id: 'records', title: '新功能：成长记录', benefit: '成长记录展示建厂进度，目标达成后奖励会自动到账。',
    instruction: '在记录中查看已完成的目标和下一章；平时继续跟随首页的当前目标即可。', action: 'quests', buttonLabel: '查看成长记录',
    unlock: '完成第 1 张订单后，解锁成长记录' },
  { id: 'rewards', title: '可选助力：经营奖励', benefit: '奖励视频可提供限时自动增压、订单加价或设备赞助，帮助加快经营。',
    instruction: '需要助力时再自行选择。普通装车、免费爆锅和机器换代都可以直接完成，教学无需观看广告。', action: 'turbo', buttonLabel: '查看可选助力',
    unlock: '完成第 1 张订单并游玩 90 秒后，解锁可选经营助力' },
  { id: 'brand', title: '可选助力：品牌合作', benefit: '完成品牌合作后获得永久产量加成，点击、自动生产和爆锅都会受益。',
    instruction: '每代机器开放部分合作等级，可按需选择；无需品牌合作也能继续完成主线。', action: 'brand', buttonLabel: '查看品牌合作',
    unlock: '换代至电热锅后，解锁可选品牌合作' },
  { id: 'pot', title: '新机制：按锅投料', benefit: '双缸机进入批次生产，每锅的有效投料能帮助增加产出并蓄能。',
    instruction: '每锅最多投料 3 次，两次投料间隔 1 秒。次数用完后等待出锅，下一锅会恢复投料次数。', action: 'tap', buttonLabel: '查看当前这锅',
    unlock: '换代至双缸机后，解锁按锅投料' },
  { id: 'contracts', title: '新功能：客户合同', benefit: '从第 7 单开始，接取客户合同后生产指定货物，交付时结算奖励和暂存货款。',
    instruction: '先接影院大批量，装满数量即可交付。合同会占用部分产能，期间现款变少，暂存货款在装车时一起到账。', action: 'order', buttonLabel: '选择影院合同',
    unlock: '完成 6 张订单并换代至双缸机后，解锁影院合同' },
  { id: 'modules', title: '新功能：设备图鉴', benefit: '六件设备逐步加入工厂，获得后永久保留、同时生效。',
    instruction: '图鉴显示每件设备的用途和获取进度。先完成第 7 单，获得装箱臂和糖衣机；继续经营就能逐步收齐。', action: 'modules', buttonLabel: '查看设备图鉴',
    unlock: '换代至双缸机后，开放设备图鉴' },
  { id: 'gift', title: '新合同：精品糖衣礼盒', benefit: '礼盒合同需要糖衣成品，奖励比普通大批量合同更高。',
    instruction: '原料装入合同后还要自动加工糖衣。已获得的糖衣机会让加工速度提高 150%；接单后观察糖衣成品进度。', action: 'order', buttonLabel: '查看礼盒合同',
    unlock: '完成第 7 张订单后，解锁糖衣礼盒合同' },
  { id: 'festival', title: '新合同：庆典现场爆香', benefit: '庆典合同按真实出锅次数交付，适合安排集中爆发，奖励更高。',
    instruction: '本单需要完成 3 次真实出锅。普通生产份数不算锅数，自动爆锅和释放蓄压都算。', action: 'order', buttonLabel: '查看庆典合同',
    unlock: '完成第 8 张订单后，解锁庆典合同' },
  { id: 'pressure', title: '获得设备：蓄压罐', benefit: '每次满锅自动增产 25%，获得后立即生效。',
    instruction: '默认自动放锅。想留一锅集中出货，可在图鉴切换「手动储压」；切回自动会立即放出已存的一锅。', action: 'modules', buttonLabel: '查看蓄压罐',
    unlock: '完成第 8 张订单后，解锁蓄压罐' },
  { id: 'bulk', title: '新功能：批量升级', benefit: '一次购买最多 5 级升级，减少后期重复操作。',
    instruction: '在升级面板查看本次级数和总价。订单条件齐备后，批量购买会保留下一代机器所需金币。', action: 'upgrades', buttonLabel: '查看批量升级',
    unlock: '换代至多头机后，解锁批量升级' },
  { id: 'feeder', title: '获得设备：自动送料器', benefit: '每次蓄满锅，送料器都会自动额外添料一次。',
    instruction: '自动添料不消耗你每锅的三次手动额度。继续点击添料或等待生产，送料器会自动工作。', action: 'modules', buttonLabel: '查看自动送料器',
    unlock: '换代至多头机后，获得自动送料器' },
  { id: 'reclaimer', title: '获得设备：热能回收器', benefit: '自然蓄能速度提高 10%，自动爆锅更加频繁。',
    instruction: '回收器会持续利用出锅余热。搭配已获得的送料器和蓄压罐，一起增加每锅的收获。', action: 'modules', buttonLabel: '查看热能回收器',
    unlock: '换上多头机且累计出锅 15 次，或完成第 13 单后，获得热能回收器' },
  { id: 'inspector', title: '获得设备：质检台', benefit: '新接合同的基础奖金提高 5%，设备效果永久保留。',
    instruction: '三类合同各交付一次可提前获得，也会在完成第 16 单时获得。获得后的新合同会自动计入质检奖金。', action: 'modules', buttonLabel: '查看质检台',
    unlock: '三类合同各交付一次，或完成第 16 单后，获得质检台' },
  { id: 'souvenirs', title: '新功能：竣工纪念', benefit: '主线完成后，可以用经营积累收藏城市招牌、金色奖杯和星光灯饰。',
    instruction: '在竣工记录中回顾建厂历程，按喜好购买纪念品。收藏不会消耗已获得的生产能力。', action: 'souvenirs', buttonLabel: '查看竣工纪念',
    unlock: '建成巨型爆米花塔并完成全部 20 张订单后，解锁竣工纪念' }
];
const LESSON_IDS = new Set(LESSONS.map(lesson => lesson.id));

function hasProgress(state = {}) {
  return ['coins', 'totalCoins', 'totalProduced', 'taps', 'bursts', 'orderIndex', 'machine', 'playedSeconds'].some(key => number(state[key]) > 0)
    || ['tap', 'auto', 'value'].some(key => upgrade(state, key) > 0);
}

const PRACTICES = ['production', 'tapVerified', 'autoObserved', 'orderClaimed', 'valueVerified'];
function normalizeOnboarding(raw, state = {}) {
  const valid = raw && typeof raw === 'object' && !Array.isArray(raw) && [1, 2].includes(raw.version);
  const legacy = valid ? raw.legacy === true : hasProgress(state);
  const seen = valid && Array.isArray(raw.seen) ? [...new Set(raw.seen.filter(id => typeof id === 'string' && LESSON_IDS.has(id)))] : [];
  if (!valid && legacy) {
    const features = featureAccess({ ...state, onboarding: { legacy: true } });
    for (const lesson of LESSONS) if (lesson.id === 'production' || features[lesson.id]) seen.push(lesson.id);
  }
  const practice = Object.fromEntries(PRACTICES.map(key => [key, !!(valid && raw.version === 2 && raw.practice && raw.practice[key] === true)]));
  const baselines = { tap: null, auto: null, value: null };
  if (valid && raw.version === 2) {
    for (const key of Object.keys(baselines)) {
      const saved = raw.baselines && raw.baselines[key];
      if (!saved || typeof saved !== 'object' || Array.isArray(saved) || upgrade(state, key) < 1) continue;
      baselines[key] = Object.fromEntries(['before', 'after', 'taps', 'playedSeconds', 'totalProduced', 'totalCoins'].map(field => [field, number(saved[field])]));
      if (key === 'auto') baselines[key].observedAt = Math.min(number(state.playedSeconds), Math.max(baselines[key].playedSeconds, number(saved.observedAt)));
    }
  } else {
    // Earlier saves did not record demonstrations. Preserve their established
    // economic stages; reading or dismissing old lessons is never proof of play.
    const established = number(state.machine) > 0 || number(state.orderIndex) > 0;
    practice.production = number(state.taps) > 0 || number(state.totalProduced) >= 16 || established;
    practice.tapVerified = upgrade(state, 'tap') > 0 || upgrade(state, 'auto') > 0 || established;
    practice.autoObserved = upgrade(state, 'auto') > 0 || established;
    practice.orderClaimed = number(state.orderIndex) > 0 || number(state.machine) > 0;
    practice.valueVerified = upgrade(state, 'value') > 0 || number(state.machine) > 0;
  }
  return { version: 2, legacy, seen, skipped: !!(valid && raw.version === 2 && raw.skipped === true), practice, baselines,
    autoObservationSeconds: valid && raw.version === 2 ? Math.min(3, number(raw.autoObservationSeconds)) : 0 };
}

const amount = value => Math.ceil(number(value)).toLocaleString('zh-CN');
function beginnerGoal(view) {
  const state = view.state || {}, features = featureAccess(state), onboarding = normalizeOnboarding(state.onboarding, state);
  if (onboarding.legacy || number(state.machine) > 0) return null;
  const practice = onboarding.practice, established = number(state.orderIndex) > 0;
  const goal = (id, step, title, text, action, anchor, extra = {}) => ({ id: 'onboarding:' + id, source: 'onboarding',
    title, text, action, anchor, buttonLabel: '', reason: '亲手试一次，看看发生了什么', step, total: 5, ...extra });
  if (!features.tapUpgrade) return goal('production', 1, number(state.taps) ? '继续点锅攒金币' : '点一下这口锅',
    number(state.taps) ? '已点 ' + Math.min(5, number(state.taps)) + '/5 次，金币正在进钱包。' : '爆米花卖出后，金币飞进钱包。', 'tap', 'machine', { phase: 'produce' });
  const upgradeGoal = (key, step, title, benefit) => {
    const item = (view.upgrades || []).find(item => item.key === key);
    const cost = number(item && item.cost), missing = Math.max(0, cost - number(state.coins));
    const name = item && item.name || ({ tap: '爆裂玉米', auto: '自动火力', value: '焦糖配方' })[key];
    if (missing > 0) return goal(key, step, '继续点锅攒金币', '还差 ' + amount(missing) + ' 金币，继续点锅。',
      'tap', 'machine', { phase: 'save', upgradeKey: key, missingCoins: missing });
    return goal(key, step, title, '点「' + name + '」，' + benefit + '。', 'upgrade:' + key, 'upgrades', { phase: 'buy', upgradeKey: key });
  };
  if (upgrade(state, 'tap') < 1 && upgrade(state, 'auto') < 1 && !established) return upgradeGoal('tap', 2, '点升级，玉米增产', '增加点击产量');
  const verification = (key, step, title, text, unit) => {
    const baseline = onboarding.baselines[key];
    return goal(key + '-verify', step, title, text, 'tap', 'machine', { phase: 'verify', upgradeKey: key,
      ...(baseline ? { before: baseline.before, after: baseline.after, unit } : {}) });
  };
  if (upgrade(state, 'tap') > 0 && !practice.tapVerified && !established)
    return verification('tap', 2, '再点锅看看增产', '同样点一下，这次爆出更多。', '份/次');
  if (upgrade(state, 'auto') < 1 && !established) return upgradeGoal('auto', 3, '升级自动火力', '加快自动生产');
  if (!practice.autoObserved && !established) {
    const baseline = onboarding.baselines.auto;
    return goal('auto-observe', 3, '松手看看', '机器持续出货，钱包自己增长。', 'observe', 'wallet', {
      phase: 'observe', observationSeconds: onboarding.autoObservationSeconds, observationTarget: 3,
      ...(baseline ? { before: baseline.before, after: baseline.after, unit: '金币/秒' } : {}) });
  }
  if (!established) {
    const order = view.order || {};
    return order.ready ? goal('order', 4, '第一单可以装车', '点装车，领取 ' + amount(order.reward) + ' 金币。', 'order', 'order', { phase: 'deliver' })
      : goal('order', 4, '继续生产装满', '还差 ' + amount(number(order.target) - number(state.totalProduced)) + ' 份，点锅继续生产。', 'tap', 'machine', { phase: 'produce' });
  }
  if (upgrade(state, 'value') < 1 && number(state.machine) < 1) return upgradeGoal('value', 5, '升级焦糖配方', '提高每份售价');
  if (!practice.valueVerified) return verification('value', 5, '再点锅看看售价', '这次每份都能卖出更多金币。', '金币/份');
  return null;
}

function selectOnboarding(view = {}) {
  const state = view.state || {}, features = featureAccess(state);
  const seen = new Set(state.onboarding && Array.isArray(state.onboarding.seen) ? state.onboarding.seen : []);
  const lessons = LESSONS.filter(lesson => lesson.id === 'production' || features[lesson.id])
    .map(({ unlock, ...lesson }) => ({ ...lesson, seen: seen.has(lesson.id) }));
  const next = LESSONS.find(lesson => lesson.id !== 'production' && !features[lesson.id]);
  const onboarding = normalizeOnboarding(state.onboarding, state), practiceGoal = beginnerGoal(view);
  return { features, lesson: null, lessons, goal: onboarding.skipped ? null : practiceGoal,
    skipped: onboarding.skipped, completed: !practiceGoal, nextUnlock: next ? next.unlock : '' };
}

module.exports = { featureAccess, normalizeOnboarding, selectOnboarding };
