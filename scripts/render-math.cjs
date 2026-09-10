// JSON batch in, rendered HTML strings out. Used only by the Python build.
const fs = require('node:fs');
const katex = require('katex');

try {
  const equations = JSON.parse(fs.readFileSync(0, 'utf8'));
  const rendered = equations.map(({ tex, displayMode }) => {
    try {
      return katex.renderToString(tex, {
        displayMode,
        output: 'htmlAndMathml',
        throwOnError: true,
        strict: 'error',
        trust: false,
        maxExpand: 1000,
      });
    } catch (error) {
      throw new Error(`Equation ${JSON.stringify(tex)}: ${error.message}`);
    }
  });
  process.stdout.write(JSON.stringify(rendered));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
