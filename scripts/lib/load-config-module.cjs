const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

/** 在 Node 中读取项目的纯数据 TS/JSON 模块，生成器和回归测试共用。 */
function createConfigLoader(root = path.resolve(__dirname, '../..')) {
  const cache = new Map()
  function load(file) {
    const filename = path.resolve(root, file)
    if (cache.has(filename)) return cache.get(filename).exports
    const module = { exports: {} }
    cache.set(filename, module)
    const source = fs.readFileSync(filename, 'utf8')
    if (filename.endsWith('.json')) {
      module.exports = JSON.parse(source)
    } else {
      const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      }).outputText
      const localRequire = (name) => {
        if (!name.startsWith('.')) return require(name)
        const target = path.resolve(path.dirname(filename), name)
        return load(path.extname(target) ? target : `${target}.ts`)
      }
      vm.runInThisContext(`(function(module, exports, require) {\n${code}\n})`, { filename })(module, module.exports, localRequire)
    }
    return module.exports
  }
  return load
}

module.exports = { createConfigLoader }
