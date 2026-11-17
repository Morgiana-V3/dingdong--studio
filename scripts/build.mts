import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const build = path.join(root, 'build')
const compiler = path.join(root, 'node_modules/typescript/bin/tsc')

// Type checking finishes before replacing the previous runnable build.
for (const config of [
  'tsconfig.json',
  'tsconfig.renderer.json',
  'tsconfig.tests.json',
  'tsconfig.tooling.json',
]) {
  execFileSync(process.execPath, [compiler, '-p', config, '--noEmit'], {
    cwd: root,
    stdio: 'inherit',
  })
}
fs.rmSync(build, { recursive: true, force: true })
for (const config of ['tsconfig.json', 'tsconfig.renderer.json', 'tsconfig.tests.json']) {
  execFileSync(process.execPath, [compiler, '-p', config], { cwd: root, stdio: 'inherit' })
}
for (const directory of ['src/ui', 'examples']) {
  fs.cpSync(path.join(root, directory), path.join(build, directory), {
    recursive: true,
    filter: (source) => !/\.(?:ts|cts|mts)$/.test(source),
  })
}
for (const filename of ['README.md', 'THIRD_PARTY_NOTICES.txt']) {
  fs.copyFileSync(path.join(root, filename), path.join(build, filename))
}
// Copy the production dependency graph, including nested dependencies, without dev tools.
// npm is a .cmd shim on Windows; invoke its JS entry point without a shell.
const npmCLI =
  process.env.npm_execpath ||
  (process.platform === 'win32'
    ? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
    : undefined)
const dependencies = execFileSync(
  npmCLI ? process.execPath : 'npm',
  [...(npmCLI ? [npmCLI] : []), 'ls', '--omit=dev', '--all', '--parseable'],
  {
    cwd: root,
    encoding: 'utf8',
  },
)
  .trim()
  .split('\n')
for (const dependency of new Set(dependencies)) {
  const relative = path.relative(root, dependency)
  if (!relative.startsWith('node_modules' + path.sep)) {
    continue
  }
  fs.cpSync(dependency, path.join(build, relative), { recursive: true })
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
fs.writeFileSync(
  path.join(build, 'package.json'),
  JSON.stringify(
    {
      name: manifest.name,
      productName: manifest.productName,
      version: manifest.version,
      description: manifest.description,
      main: 'src/main.cjs',
      dependencies: manifest.dependencies,
    },
    null,
    2,
  ) + '\n',
)
console.log('Built MiniPush, plugins, and tests into build/')
