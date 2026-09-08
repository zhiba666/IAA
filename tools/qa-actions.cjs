'use strict';
// Isolated QA actions share the production rules, never a platform or save store.
const { CONFIG } = require('../src/core.js');
const { selectCurrentTarget } = require('../src/experience.js');
const { selectNextStep } = require('../src/next-step.js');
const PANELS = new Set(['upgrades','order','machine','quests','workshop','settings','help','privacy',
  'health','stats','blueprint','completion','brand','turbo','offline','souvenirs','modules','guidebook']);

function dispatchQAAction(game, ui, action, hooks = {}) {
  if (typeof action !== 'string' || !action || ui.adBusy || ui.startup) return null;
  const modalIs = type => ui.modal && ui.modal.type === type;
  function open(type, focusUpgrade = '') {
    const view = game.getView();
    ui.modal = {type,...(type === 'upgrades'?{quantity:1}:{})};
    ui.focusUpgrade = type === 'upgrades'?focusUpgrade:'';
    ui.toast='';ui.toastKind='';
    if (type === 'quests') ui.modal.chapterId=view.quests.activeChapterId;
    if (type === 'order') ui.modal.contractQuotes=Object.fromEntries((view.contracts && view.contracts.options || []).map(item=>[item.kind,JSON.parse(JSON.stringify(item))]));
    if (type === 'souvenirs') ui.modal.souvenirQuotes=Object.fromEntries(view.souvenirs.options.map(item=>[item.key,{...item}]));
  }
  const close = () => {ui.modal=null;ui.focusUpgrade='';ui.toast='';ui.toastKind='';};
  function finish(result, message, panel) {
    if (result && result.ok) {if(panel)open(panel);else close();if(message)ui.toast=message;}
    return result;
  }
  if(modalIs('guide')&&action!=='close'&&!action.startsWith('guideContinue:'))return null;
  if (action === 'target') {
    const target=selectCurrentTarget(game.getView(),ui);
    if(!target||!target.action||target.action==='target')return null;
    if(target.action.startsWith('upgrade:')){open('upgrades',target.action.slice(8));return null;}
    return dispatchQAAction(game,ui,target.action,hooks);
  }
  if(action==='close'){close();return null;}
  if(action==='guideSkip'||action==='guideResume'){
    if(ui.modal&&!modalIs('guidebook')&&!modalIs('help'))return null;
    if(action==='guideResume'&&!ui.modal)return null;
    const result=game.setOnboardingSkipped(action==='guideSkip');close();return result;
  }
  if(action.startsWith('guideReview:')){
    if(!modalIs('guidebook')&&!modalIs('help'))return null;
    const id=action.slice(12),lesson=game.getView().onboarding.lessons.find(item=>item.id===id);
    if(lesson)ui.modal={type:'guide',guideId:id,replay:true};
    return null;
  }
  if(action.startsWith('guideContinue:')){if(modalIs('guide')&&ui.modal.guideId===action.slice(14))close();return null;}
  if(action==='observe')return null;
  if(action==='goalExpand'||action==='goalCollapse'){if(!ui.modal)ui.goalExpanded=action==='goalExpand';return null;}
  if(action==='tap')return ui.modal?null:game.tap();
  if(action==='releasePressure')return ui.modal?null:game.releasePressure();
  if(action==='evolve'){close();return hooks.evolve?hooks.evolve():game.evolve();}
  if(action==='claimOrder'||action==='claimOffline')return finish(action==='claimOrder'?game.claimOrder():game.claimOffline());
  if(action.startsWith('pressureMode:'))return modalIs('modules')?game.setPressureMode(action.slice(13)):null;
  if(action.startsWith('contractAccept:')){
    if(!modalIs('order'))return null;
    const rest=action.slice(15),cut=rest.indexOf(':');if(cut<0)return null;
    const kind=rest.slice(0,cut),id=rest.slice(cut+1),quote=ui.modal.contractQuotes&&ui.modal.contractQuotes[kind];
    if(!quote||quote.id!==id)return null;
    const result=finish(game.acceptContract(kind,quote),'订单已接下');
    if(result&&result.ok)ui.goalExpanded=true;
    return result;
  }
  if(action.startsWith('contractCancel:')){
    if(!modalIs('order'))return null;
    const id=action.slice(15);
    if(ui.modal.cancelContractId!==id){ui.modal.cancelContractId=id;ui.toast='本单进度将清空，再点一次放弃';return null;}
    return finish(game.cancelContract(id),'本单已放弃','order');
  }
  if(action.startsWith('upgrade:')){
    const key=action.slice(8),onboarding=game.getView().onboarding;
    const first=game.state.machine===0&&game.state.upgrades[key]===0&&!onboarding.skipped&&!game.state.onboarding.legacy;
    const result=game.buyUpgrade(key);
    if(first&&result.ok)close();
    return result;
  }
  if(action.startsWith('upgradeQuantity:')||action.startsWith('upgradeBatch:')){
    if(!modalIs('upgrades')||!game.getView().milestones.bulkUpgrade.unlocked)return null;
    if(action.startsWith('upgradeQuantity:')){
      const quantity=Number(action.slice(16));if([1,CONFIG.bulkUpgradeMaxCount].includes(quantity))ui.modal.quantity=quantity;
      return null;
    }
    const parts=action.split(':');if(ui.modal.quantity!==CONFIG.bulkUpgradeMaxCount||parts.length!==5)return null;
    const [,key,fromLevel,count,cost]=parts;
    return game.buyUpgradeBatch(key,{fromLevel:Number(fromLevel),count:Number(count),cost:Number(cost)});
  }
  if(action.startsWith('fundingUpgrade:')){
    const step=selectNextStep(game.getView());
    if(modalIs('machine')&&step.kind==='upgrade'&&step.enabled&&step.estimate&&step.upgradeKey===action.slice(15))open('upgrades',step.upgradeKey);
    return null;
  }
  if(action.startsWith('souvenir:')){
    if(!modalIs('souvenirs'))return null;
    const key=action.slice(9),quote=ui.modal.souvenirQuotes&&ui.modal.souvenirQuotes[key];
    return quote?finish(game.buySouvenir(key,quote),'收藏已陈列','souvenirs'):null;
  }
  if(action.startsWith('questClaim:'))return game.claimQuest(action.slice(11));
  if(action.startsWith('questChapter:')){
    const id=action.slice(13);
    if(modalIs('quests')&&game.getView().quests.chapters.some(chapter=>chapter.id===id)){ui.modal.chapterId=id;ui.modal.page=0;}
    return null;
  }
  for(const [prefix,panel] of [['questPage:','quests'],['blueprintPage:','blueprint'],['contractPage:','order'],['modulePage:','modules'],['guidePage:','guidebook']]){
    if(action.startsWith(prefix)){
      const page=Number(action.slice(prefix.length));
      if(modalIs(panel)&&Number.isInteger(page)&&page>=0&&page<20)ui.modal.page=page;
      return null;
    }
  }
  if(action.startsWith('questGo:')){
    const quest=game.getView().quests.chapters.flatMap(chapter=>chapter.quests).find(item=>item.id===action.slice(8));
    if(!quest||quest.locked||quest.claimed)return null;
    close();ui.questGuideId=quest.id;
    if(quest.action.startsWith('upgrade:'))open('upgrades',quest.action.slice(8));
    else if(PANELS.has(quest.action))open(quest.action);
    ui.toast=quest.hint;return null;
  }
  if(action.startsWith('setting:')){const key=action.slice(8);return game.setSetting(key,!game.state.settings[key]);}
  if(PANELS.has(action)){open(action);return null;}
  return {ok:false,reason:'本地夹具不执行广告、平台或玩家存档操作'};
}
module.exports = { dispatchQAAction };
