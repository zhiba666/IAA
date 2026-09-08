import { readFile } from 'node:fs/promises';
import path from 'node:path';

// QA runs real game/presentation code without the application or host adapters.
export function allowQAModule(id) {
  return id === 'tools/qa-actions.cjs' ||
    (id.startsWith('src/') && !/\/(main|platform)\.js$/.test(id));
}

export async function bundleCommonJS({ root, entries, allowModule = () => true, initialize }) {
  root = path.resolve(root);
  const modules = new Map();
  async function collect(file) {
    file = path.resolve(root, file);
    const relative = path.relative(root, file);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw new Error('Dependency outside project');
    }
    const id = relative.replaceAll('\\', '/');
    if (!allowModule(id)) throw new Error('Module not allowed: ' + id);
    if (modules.has(id)) return id;
    modules.set(id, '');
    let source = await readFile(file, 'utf8');
    for (const match of [...source.matchAll(/require\(['"](\.\.?\/[^'"]+)['"]\)/g)]) {
      const request = /\.c?js$/.test(match[1]) ? match[1] : match[1] + '.js';
      const dependency = await collect(path.resolve(path.dirname(file), request));
      source = source.replace(match[0], 'require(' + JSON.stringify(dependency) + ')');
    }
    modules.set(id, source);
    return id;
  }
  const entryIds = [];
  for (const entry of entries) entryIds.push(await collect(entry));
  const start = initialize ? '(' + initialize.toString() + ')(require);' :
    entryIds.map(id => 'require(' + JSON.stringify(id) + ');').join('\n');
  const code = `(function(){
'use strict';
const modules={${[...modules].map(([id, source]) => JSON.stringify(id) + ':function(module,exports,require){\n' + source + '\n}').join(',\n')}};
const cache=Object.create(null);
function require(id){if(cache[id])return cache[id].exports;if(!Object.prototype.hasOwnProperty.call(modules,id))throw new Error('Unknown module '+id);const m=cache[id]={exports:{}};modules[id](m,m.exports,require);return m.exports;}
${start}
})();
`;
  return { code, moduleIds: [...modules.keys()] };
}
