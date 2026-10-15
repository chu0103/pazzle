/* 把 tools/_rush_levels_out.txt 里生成好的 LEVELS 内联进 js/game/rush.js */
var fs = require('fs'), path = require('path');
var root = path.join(__dirname, '..');
var target = path.join(root, 'js/game/rush.js');
var src = fs.readFileSync(target, 'utf8');
var lv = fs.readFileSync(path.join(root, 'tools/_rush_levels_out.txt'), 'utf8').replace(/\s+$/, '');

var head = '  var LEVELS = [';
var start = src.indexOf(head);
if (start < 0) { throw new Error('找不到 LEVELS 起始'); }
var endMark = '\n  ];';
var end = src.indexOf(endMark, start);
if (end < 0) { throw new Error('找不到 LEVELS 结束'); }
end += endMark.length;

if (!/^\s*var LEVELS = \[/.test(lv)) { throw new Error('产出文件格式异常'); }
src = src.slice(0, start) + lv + src.slice(end);
fs.writeFileSync(target, src, 'utf8');
console.log('已内联 ' + (lv.split('\n').length - 2) + ' 关');
