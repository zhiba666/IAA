'use strict';
const { SAVE_KEY, SAVE_VERSION, MODE, LEGACY_SAVE_KEY } = require('./v13-order-mode');
const SOURCE_KEYS = ['little_popcorn_factory_automation_v4', 'little_popcorn_factory_pipeline_v2', LEGACY_SAVE_KEY];
const PENDING_KEY = SAVE_KEY + '_migration_pending';
const COMMIT_KEY = SAVE_KEY + '_migration_commit';
let nextMigration = 0;
const present = value => value !== null && value !== undefined && value !== '';
const encode = value => typeof value === 'string' ? value : JSON.stringify(value);
function parse(value) {
  const data = typeof value === 'string' ? JSON.parse(value) : value;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid-save');
  return data;
}

// Transaction journal: an uncommitted migration can never become the next
// launch's active factory, even if the host also rejects a rollback write.
function createOrderStorage({ read, write, remove }) {
  let source = null, info = null;
  function verifiedWrite(key, value) {
    write(key, value);
    if (encode(read(key)) !== value) throw new Error('save-verification-failed:' + key);
  }
  function load() {
    source = null;
    const pending = read(PENDING_KEY), committed = read(COMMIT_KEY);
    const unfinished = present(pending) && committed !== pending;
    let pendingSource = null;
    if (unfinished) {
      try { pendingSource = parse(pending).key; } catch (_) {}
      // A torn journal cannot authorize the candidate. Recover only from an
      // untouched source; a new transaction can replace this provisional flag.
      if (!SOURCE_KEYS.includes(pendingSource)) pendingSource = null;
    }
    const current = read(SAVE_KEY);
    if (!unfinished && present(current)) {
      info = { key: SAVE_KEY, kind: 'current', alternatives: [] };
      return parse(current);
    }
    const candidates = [];
    for (const key of SOURCE_KEYS) {
      const raw = read(key);
      if (present(raw)) candidates.push({ key, raw: encode(raw) });
    }
    source = unfinished && pendingSource ? candidates.find(item => item.key === pendingSource) : candidates[0];
    if (unfinished && !source) throw new Error('migration-source-missing');
    info = { key: source ? source.key : SAVE_KEY, kind: source ? 'migration' : 'fresh',
      alternatives: candidates.filter(item => item !== source).map(item => item.key) };
    return source ? parse(source.raw) : null;
  }
  function save(data, validate) {
    if (!data || data.version !== SAVE_VERSION || data.mode !== MODE) throw new Error('invalid-order-save');
    const encoded = JSON.stringify(data);
    if (validate && !validate(parse(encoded))) throw new Error('invalid-migrated-save');
    const previous = read(SAVE_KEY);
    let attempted = false, journal = null;
    try {
      if (source) {
        // The original document is never mutated, and an existing backup is
        // never overwritten with a different historical snapshot.
        const backupKey = SAVE_KEY + '_backup_' + source.key;
        const backup = read(backupKey);
        if (present(backup) && encode(backup) !== source.raw) throw new Error('backup-conflict');
        verifiedWrite(backupKey, source.raw);
        journal = JSON.stringify({ key: source.key, transaction: Date.now() + ':' + (++nextMigration) });
        verifiedWrite(PENDING_KEY, journal);
      }
      attempted = true;
      verifiedWrite(SAVE_KEY, encoded);
      if (validate && !validate(parse(read(SAVE_KEY)))) throw new Error('migrated-readback-invalid');
      if (source) verifiedWrite(COMMIT_KEY, journal);
      source = null;
      return true;
    } catch (error) {
      if (attempted) {
        try { if (present(previous)) write(SAVE_KEY, previous); else remove(SAVE_KEY); } catch (_) {}
      }
      throw error;
    }
  }
  return { load, save, get info() { return info; } };
}
module.exports = { createOrderStorage, SOURCE_KEYS, PENDING_KEY, COMMIT_KEY };
