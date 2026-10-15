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
require('./js/game/photoAssets.js'); // 游戏 3 内置照片清单（tools/process_photos.py 生成）
require('./js/game/photo.js');     // 游戏 3「照片拼图」关卡生成器 + 图片仓库
require('./js/game/diffAssets.js'); // 游戏 4 内置图对清单（tools/make_diff_pairs.py 生成）
require('./js/game/diff.js');      // 游戏 4「图片找不同」关卡生成器 + 图片仓库
require('./js/game/bottle.js');     // 游戏 5「瓶子颜色推理」关卡生成器
require('./js/game/cipher.js');     // 游戏 6「密码推理」关卡生成器（含反馈算法）
require('./js/game/rush.js');       // 游戏 7「移车出库」关卡生成器 + BFS 求解器
require('./js/game/blocks.js');     // 游戏 8「超级积木」关卡生成器 + 数据层
require('./js/game/sudoku.js');     // 游戏 9「九宫格数独」关卡生成器 + 求解器
require('./js/game/mine.js');      // 游戏 11「扫雷」关卡生成器 + 演绎求解器
require('./js/game/picross.js');   // 游戏 12「数织」关卡数据层 + 唯一解求解器
require('./js/game/model.js');     // 棋盘状态机（前三款游戏共用）

// 4) 场景
require('./js/scenes/home.js');
require('./js/scenes/levels.js');
require('./js/scenes/diffpick.js'); // 「先选难度再进游戏」首屏（rush / diff / blocks 共用）
require('./js/scenes/ruletip.js');  // 「玩法说明」弹框（11 款游戏共用，支持「不再提示」）
require('./js/scenes/play.js');
require('./js/scenes/diff.js');    // 游戏 4 玩法场景（找不同：点按标记）
require('./js/scenes/bottle.js');  // 游戏 5 玩法场景（瓶子：交换两瓶排顺序）
require('./js/scenes/cipher.js');  // 游戏 6 玩法场景（密码：拼一行猜测换反馈）
require('./js/scenes/rush.js');    // 游戏 7 玩法场景（移车出库：拖动车辆求解）
require('./js/scenes/blocks.js');   // 游戏 8 玩法场景（超级积木：拖积木填亮区）
require('./js/scenes/sudoku.js');   // 游戏 9 玩法场景（九宫格数独：填数求解）
require('./js/scenes/mine.js');     // 游戏 11 玩法场景（扫雷：翻格/插旗/免猜）
require('./js/scenes/picross.js');  // 游戏 12 玩法场景（数织：看行列线索填彩色像素画）

// 5) 启动
require('./js/app.js');

var BF = GameGlobal.BF;
if (BF.platform.keepScreenOn) { BF.platform.keepScreenOn(); }
console.log('[puzzle-arcade] v' + BF.VERSION + ' started');
