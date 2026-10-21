// Typecheck for a package that has no sources: both configs must parse (they are JSONC),
// the extends chain must resolve, and the compiler options must be valid.
import ts from 'typescript'

let failed = false
for (const file of ['tsconfig.base.json', 'tsconfig.bundler.json']) {
  const read = ts.readConfigFile(file, ts.sys.readFile)
  const parsed = read.error
    ? { errors: [read.error] }
    : ts.parseJsonConfigFileContent(read.config, ts.sys, '.', undefined, file)
  // TS18003 (no input files) is expected: these configs have no sources of their own.
  const errors = parsed.errors.filter((e) => e.code !== 18003)
  for (const e of errors) console.error(ts.flattenDiagnosticMessageText(e.messageText, '\n'))
  if (errors.length > 0) failed = true
}
process.exit(failed ? 1 : 0)
