/**
 * game.js —— 微信小游戏入口
 * 只做一件事：按依赖顺序装载模块。App 会在 app.js 装载完成后自动启动。
 */

// 1) 基础层
require('./js/core/ns.js');        // 命名空间 + 工具
require('./js/core/palette.js');   // 配色 / 主题
require('./js/core/draw.js');      // Canvas 绘制原语

// 2) 宿主环境（必须在 app.js 之前）
require('./js/platform/wx.js');

// 3) 数据与逻辑层
require('./js/core/save.js');      // 存档（按游戏分桶）
require('./js/game/generator.js'); // 游戏 1「方块拼图」关卡生成器 + 难度曲线
require('./js/game/logic.js');     // 游戏 2「逻辑拼图」关卡生成器
require('./js/game/model.js');     // 棋盘状态机（两款游戏共用）

// 4) 场景
require('./js/scenes/home.js');
require('./js/scenes/levels.js');
require('./js/scenes/play.js');

// 5) 启动
require('./js/app.js');

var BF = GameGlobal.BF;
if (BF.platform.keepScreenOn) { BF.platform.keepScreenOn(); }
console.log('[puzzle-arcade] v' + BF.VERSION + ' started');
