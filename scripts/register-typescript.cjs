// Load the provider sources in Node without generating files in the extension bundle.
const fs = require('node:fs');
const { transformSync } = require('esbuild');

require.extensions['.ts'] = (module, filename) => {
  const { code } = transformSync(fs.readFileSync(filename, 'utf8'), {
    loader: 'ts', format: 'cjs', target: 'node18', sourcefile: filename,
  });
  module._compile(code, filename);
};
