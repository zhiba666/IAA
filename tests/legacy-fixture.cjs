'use strict';
const { Game } = require('../src/core');
const { selectOnboarding, normalizeOnboarding } = require('../src/onboarding');

// Existing economy, contract and layout scenarios deliberately retain their
// pre-guide access and earned equipment. New-player tests instantiate Game directly.
function legacyGame(options = {}) {
  const game = new Game(options);
  game.state.onboarding = normalizeOnboarding({ version: 1, legacy: true, seen: [] },game.state);
  // These isolated legacy scenarios already know every mechanic; milestones
  // are changed directly by each fixture, independently of tutorial timing.
  game.state.onboarding.seen = selectOnboarding({ state: {
    ...game.state, machine: 5, orderIndex: 20, playedSeconds: 90, bursts: 1,
    factory: { ...game.state.factory, owned: ['coating', 'packer', 'pressure', 'feeder', 'reclaimer', 'inspector'] }
  } }).lessons.map(lesson => lesson.id);
  game.state.factory.owned = ['coating', 'packer'];
  return game;
}

module.exports = { legacyGame };
