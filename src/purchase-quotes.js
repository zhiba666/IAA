'use strict';

// A quote describes exactly the offer displayed in one modal. Affordability is
// rechecked by Game at confirmation; changing the balance does not change price.
function describeOffer(view, key) {
  const state = view.state, generation = state.machine;
  if (key === 'expansion') {
    const offer = view.expansion;
    return offer ? { key, kind: 'expansion', generation, level: generation + 1,
      name: offer.name, cost: offer.cost, requiredSold: offer.requiredSold, targetRate: offer.targetRate } : null;
  }
  if (key === 'logistics') {
    const offer = view.logisticsUpgrade;
    return offer ? { key, kind: 'logistics', generation, level: state.logisticsLevel + 1,
      name: '仓位改造', cost: offer.cost, batchAfter: offer.batchAfter,
      inputAfter: offer.inputAfter, capacityAfter: offer.capacityAfter } : null;
  }
  if (/^automate-(pop|cup)$/.test(key)) {
    const source = key.slice(9), route = (view.transfers || []).find(row => row.source === source);
    if (!route || route.automated || !route.automation) return null;
    return { key, kind: 'automation', generation, source, target: route.target, level: 1,
      name: source === 'pop' ? '自动补料' : '自动送货', cost: route.automation.cost };
  }
  if (/^upgrade-(pop|cup|ship)$/.test(key)) {
    const stationId = key.slice(8), station = view.stations.find(row => row.id === stationId);
    const offer = station && station.upgrade;
    return offer ? { key, kind: 'upgrade', generation, stationId, level: station.level + 1,
      name: offer.name, cost: offer.cost, capacity: offer.capacity, requiredMachine: offer.requiredMachine } : null;
  }
  return null;
}

function quoteMatches(quote, view) {
  if (!quote || quote.used) return false;
  const offer = describeOffer(view, quote.key);
  return !!offer && JSON.stringify(offer) === quote.fingerprint
    && Object.keys(offer).every(key => JSON.stringify(quote[key]) === JSON.stringify(offer[key]));
}

module.exports = { describeOffer, quoteMatches };
