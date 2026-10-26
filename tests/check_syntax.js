// 按"浏览器脚本"的规则编译所有扩展脚本。
// 注意:`node --check` 把文件当成函数体,会放过顶层的 return 之类;浏览器不会。这里用 vm.Script,和浏览器一致。
const vm = require("vm"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
let bad = 0;
for (const f of ["inject.js", "parse.js", "card.js", "content.js", "popup.js"]) {
  try { new vm.Script(fs.readFileSync(path.join(root, f), "utf8"), { filename: f }); console.log("OK  ", f); }
  catch (e) { bad++; console.log("FAIL", f, e.message); }
}
process.exit(bad ? 1 : 0);
