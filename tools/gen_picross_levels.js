/**
 * gen_picross_levels.js —— 第 12 款「数织」离线关卡生成器
 *
 * 流程：
 *   1. 图案库（PATTERNS）是手工画的 ASCII 点阵，字母 = PALETTE 颜色序号
 *      （R0 红 O1 橙 Y2 黄 G3 绿 T4 青 B5 蓝 P6 紫 N7 棕 S8 粉 K9 墨），'.' = 空位；
 *   2. 逐关算行/列线索，用数据层的唯一解求解器（BF.PicrossGen.isUnique）过滤：
 *      **只有线索能推出唯一解的图案才入选**，否则玩家可能推出两种合法填法；
 *   3. 每档取前 10 个通过校验的图案，base-36 编码后写回 js/game/picross.js
 *      的 __PICROSS_LEVELS_BEGIN__ / __PICROSS_LEVELS_END__ 标记位之间。
 *
 * 用法：node tools/gen_picross_levels.js
 *   —— 先落 txt（tools/_picross_levels_out.txt）再改 js，核对无误才算生成完。
 */
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');

global.BF = {};
require(path.join(root, 'js/core/ns.js'));
require(path.join(root, 'js/game/picross.js'));
var Gen = BF.PicrossGen;

var LETTERS = {
  R: 0, O: 1, Y: 2, G: 3, T: 4, B: 5, P: 6, N: 7, S: 8, K: 9
};

/* ================= 图案库 ================= */

var PATTERNS = {};

/* ---- 入门 5×5（2~3 色）---- */
PATTERNS[0] = [
  { name: '爱心', rows: [
    '.R.R.',
    'RRRRR',
    'RRRRR',
    '.RRR.',
    '..R..'
  ] },
  { name: '星星', rows: [
    '..Y..',
    '.YYY.',
    'YYYYY',
    '.YYY.',
    '.Y.Y.'
  ] },
  { name: '苹果', rows: [
    '..N..',
    '.NG..',
    'RRRRR',
    'RRRRR',
    '.RRR.'
  ] },
  { name: '小鱼', rows: [
    '..OO.',
    'BOOOK',
    'BBOOK',
    'BOOOK',
    '..OO.'
  ] },
  { name: '小房子', rows: [
    '.R.R.',
    'RRRRR',
    'YNNNY',
    'Y.NNY',
    'YYYYY'
  ] },
  { name: '小花', rows: [
    'PYPYP',
    '.PYP.',
    '.PYP.',
    '..G..',
    '..G..'
  ] },
  { name: '月牙', rows: [
    '.YYY.',
    'YYY..',
    'YY...',
    'YYY..',
    '.YYY.'
  ] },
  { name: '太阳', rows: [
    'Y...Y',
    '.YYY.',
    'YYOYY',
    '.YYY.',
    'Y...Y'
  ] },
  { name: '蘑菇', rows: [
    'RRRRR',
    'RSRSR',
    'RRRRR',
    '..N..',
    '..N..'
  ] },
  { name: '雨伞', rows: [
    'PPPPP',
    'PPPPP',
    '.PPP.',
    '..N..',
    '..N.N'
  ] },
  { name: '樱桃', rows: [
    '..GG.',
    '.G..G',
    '.R.R.',
    'RR.RR',
    '.R.R.'
  ] },
  { name: '雪花', rows: [
    '..S..',
    '.BSB.',
    'SBBBS',
    '.BSB.',
    '..S..'
  ] },
  { name: '小汽车', rows: [
    '..K..',
    '.KKK.',
    'RRRRR',
    'RRRRR',
    'K...K'
  ] },
  { name: '树叶', rows: [
    '....N',
    '...GG',
    '..GGG',
    '.GGG.',
    'GGG..'
  ] }
];

/* ---- 进阶 10×10（3~4 色）---- */
PATTERNS[1] = [
  { name: '小猫', rows: [
    'NN......NN',
    'NPN....NPN',
    '.NNNNNNNN.',
    'NNSSSSSSNN',
    'NSKSSSSKSN',
    'NSKSSSSKSN',
    'NSSSSSSSSN',
    'NSSSKSSSSN',
    '.NSSSSSSN.',
    '..NNNNNN..'
  ] },
  { name: '小狗', rows: [
    'N........N',
    'NN......NN',
    'NNSSSSSSNN',
    'NSKSSSSKSN',
    'NSKSSSSKSN',
    'NSSSSKSSSN',
    'NSSSRRSSSN',
    '.NSSSSSSN.',
    '..NNNNNN..',
    '...NNNN...'
  ] },
  { name: '小兔', rows: [
    '.PP....PP.',
    '.PP....PP.',
    '.PP....PP.',
    'SSSSSSSSSS',
    'SSSKSSKSSS',
    'SSSKSSKSSS',
    'SSSSSKSSSS',
    'SSSSSSSSSS',
    '.SSSSSSSS.',
    '..SSSSSS..'
  ] },
  { name: '青蛙', rows: [
    '.GG....GG.',
    'GGGG..GGGG',
    'GGKGGGGKGG',
    '.GGGGGGGG.',
    'GGGGGGGGGG',
    'GSGGGGGGSG',
    'GGGGGGGGGG',
    '.GGGGGGGG.',
    '..GGGGGG..',
    '...GGGG...'
  ] },
  { name: '蛋糕', rows: [
    '....R.....',
    '...RRRRR..',
    '..SSSSSSS.',
    '.YYYYYYYY.',
    '.YYYYYYYY.',
    '..SSSSSSS.',
    '.YYYYYYYY.',
    '.YYYYYYYY.',
    '..SSSSSSS.',
    'NNNNNNNNNN'
  ] },
  { name: '小汽车', rows: [
    '....KK....',
    '...KSSK...',
    '..RRRRRR..',
    '.RRRRRRRR.',
    'RRRRRRRRRR',
    'RRRRRRRRRR',
    'KK......KK',
    '.K......K.',
    '..........',
    '..........'
  ] },
  { name: '小飞机', rows: [
    '......B...',
    '.....BBB..',
    '....BBBBB.',
    'SSSSSSSSSS',
    'SSSSSSSSSS',
    'RSSSSSSSSS',
    '....BBB...',
    '.....B....',
    '..........',
    '..........'
  ] },
  { name: '大树', rows: [
    '....GG....',
    '...GGGG...',
    '..GGGGGG..',
    '.GGOGGGOG.',
    '.GGGGGGGG.',
    '..GGGGGG..',
    '....NN....',
    '....NN....',
    '...NNNN...',
    '..NNNNNN..'
  ] },
  { name: '向日葵', rows: [
    '..Y.Y.Y...',
    '.YYYYYYY..',
    'YYYNNNYYYY',
    'YYYNNNYYYY',
    'YYYNNNYYYY',
    '.YYYYYYY..',
    '....GG....',
    '....GG....',
    '...GGGG...',
    '....GG....'
  ] },
  { name: '帆船', rows: [
    '.....RR...',
    '....RRRR..',
    '...RRRRRR.',
    '....SS....',
    '.....SS...',
    '....NNNN..',
    '..NNNNNNNN',
    'BBBBBBBBBB',
    'BBBBBBBBBB',
    'BBBBBBBBBB'
  ] },
  { name: '企鹅', rows: [
    '....KK....',
    '...KSSK...',
    '..KKSSKK..',
    '..KSSSSK..',
    '.KKSSSSKK.',
    '.KKSSSSKK.',
    '.KKSSSSKK.',
    '..KSSSSK..',
    '...KSSK...',
    '..OO..OO..'
  ] },
  { name: '螃蟹', rows: [
    '..K...K...',
    '.K.....K..',
    'KKRRRRRRKK',
    'KRRRRRRRRK',
    'KRRRRRRRRK',
    'KRRRRRRRRK',
    '.RRRRRRRR.',
    'K.K.K.K.K.',
    '..........',
    '..........'
  ] },
  { name: '热气球', rows: [
    '.RR..BB...',
    'RRRR.BBB..',
    'RRRR.BBB..',
    '.RR..BB...',
    '..N..N....',
    '..N..N.N..',
    '...NN.NN..',
    '..........',
    '..........',
    '..........'
  ] },
  { name: '小房子', rows: [
    '.....R....',
    '....RRR...',
    '...RRRRR..',
    '..RRRRRRR.',
    '.NNNNNNNNN',
    '.NYYNNYYN.',
    '.NYYNNYYN.',
    '.NNNNNNNNN',
    '.NNNKKNNN.',
    '.NNNKKNNN.'
  ] }
];

/* ---- 困难 12×12（4~5 色）---- */
PATTERNS[2] = [
  { name: '大象', rows: [
    '..KK....KK..',
    '.KSSK..KSSK.',
    '.KSSK..KSSK.',
    '..KKKKKKKK..',
    '..KKKKKKKK..',
    '..KSSKKSSK..',
    '..KKKKKKKK..',
    '...KKKKKK...',
    '...KKKKKK...',
    '...KKKKKK...',
    '....KKKK....',
    '....KKKK....'
  ] },
  { name: '小鹿', rows: [
    'K...K..K...K',
    '.K..K..K..K.',
    '..KKKKKKKK..',
    '...NNNNNN...',
    '...NKNNKN...',
    '...NNNNNN...',
    '...NNNNNN...',
    '...NSSSSN...',
    '....NSKSN...',
    '....NSSSN...',
    '....NNNNN...',
    '.....NNN....'
  ] },
  { name: '猫头鹰', rows: [
    '..N......N..',
    '.NYK....KYN.',
    '.NYK....KYN.',
    '.NNN....NNN.',
    '..NNNNNNNN..',
    '..NNNNNNNN..',
    '..NSSSSSSN..',
    '..NSSKSSSN..',
    '..NSSSSSSN..',
    '...NNNNNN...',
    '...N.NN.N...',
    '..NN..NN....'
  ] },
  { name: '城堡', rows: [
    '..N.N..N.N..',
    '..R.N..N.R..',
    '..RNN..NNR..',
    '.RNNNNNNNNR.',
    '.RNNNNNNNNR.',
    '.RNYNNNNYNR.',
    '.RNYNNNNYNR.',
    '.RNNNNNNNNR.',
    '..NNN..NNN..',
    '..NNN..NNN..',
    '..NNN..NNN..',
    '..NNNBBNNN..'
  ] },
  { name: '机器人', rows: [
    '.....KK.....',
    '.....KK.....',
    '.KKKKKKKKKK.',
    '.KBKSSSSKBK.',
    '.KSSKSSKSSK.',
    '.KKKKRRKKKK.',
    '...KSSSSK...',
    '..KSSSSSSK..',
    '..KSKSSKSK..',
    '..KSSSSSSK..',
    '...KKKKKK...',
    '...KK..KK...'
  ] },
  { name: '仙人掌', rows: [
    '.....R......',
    '....GGG.....',
    '....G.G.....',
    '.SS.G.G.SS..',
    '.GG.G.G.GG..',
    '.GG.....GG..',
    '...G...G....',
    '...G...G....',
    '...G...G....',
    '..GGG.GGG...',
    '..NNNNNNN...',
    '..NNNNNNN...'
  ] },
  { name: '热气球', rows: [
    '.....YY.....',
    '....Y..Y....',
    '...Y....Y...',
    '..RRRRRRRR..',
    '.RRRRRRRRRR.',
    'RRRRRRRRRRRR',
    'YYRRRRRRRRYY',
    'BBRRRRRRRRBB',
    '.BBBBBBBBBB.',
    '..BBBBBBBB..',
    '...NNNNNN...',
    '....N..N....'
  ] },
  { name: '蝴蝶', rows: [
    '..K......K..',
    '...K....K...',
    '..PYY..YYP..',
    '.PYYYPPYYYP.',
    'PPYYYPPYYYPP',
    'PPYYYYYYYYPP',
    '.PSYYYYYYSP.',
    '..PPYYYYPP..',
    '...PPYYPP...',
    '....PPPP....',
    '.....PP.....',
    '.....PP.....'
  ] },
  { name: '灯塔', rows: [
    '.....Y......',
    '....YYY.....',
    '.....YY.....',
    '....SSSS....',
    '...SSSSSS...',
    '..SRRRRRRS..',
    '..SSSSSSSS..',
    '...SSSSSS...',
    '..SRRRRRRS..',
    '...SSSSSS...',
    '..SSSKSSS...',
    '..BBBKBBB...'
  ] },
  { name: '风车', rows: [
    '...R....R...',
    '..RR....RR..',
    '..RRR..RRR..',
    '...RR..RR...',
    '....RRRR....',
    '.....NN.....',
    '....NNNN....',
    '....NYYN....',
    '...NNNNNN...',
    '..NNNYYNNN..',
    '..NNNNNNNN..',
    '..GGGGGGGG..'
  ] },
  { name: '小火车', rows: [
    '....KK......',
    '...KSSK.....',
    '..RRRRRRRR..',
    '.RRRRRRRRRR.',
    '.RRYRRRRYRR.',
    '.RRRRRRRRRR.',
    '..KKKKKKKK..',
    '..KK....KK..',
    'SSSSSSSSSSSS',
    '.SSSSSSSSSS.',
    '..KK....KK..',
    '.KK......KK.'
  ] },
  { name: '汉堡', rows: [
    '..SSSSSSSS..',
    '.SSSSSSSSSS.',
    '..GGGGGGGG..',
    '..RRRRRRRR..',
    '..YYYYYYYY..',
    '..RRRRRRRR..',
    '..YYYYYYYY..',
    '..NNNNNNNN..',
    '.NNNNNNNNNN.',
    '.NNNNNNNNNN.',
    '..NNNNNNNN..',
    '............'
  ] },
  { name: '小熊', rows: [
    '..NN....NN..',
    '.NNNN..NNNN.',
    '.NNNN..NNNN.',
    '..NN....NN..',
    '.NNNNNNNNNN.',
    '.NNNNNNNNNN.',
    '.NKNNNNNNKN.',
    '.NKNNNNNNKN.',
    '.NNNNSSNNNN.',
    '.NNNSSSSNNN.',
    '.NNNNSKNNNN.',
    '..NNNNNNNN..'
  ] },
  { name: '小猪', rows: [
    '............',
    '..SSSSSSSS..',
    '.SSSSSSSSSS.',
    '.SSKSSSSKSS.',
    '.SSSSSSSSSS.',
    '.SSSNNNNSSS.',
    '.SSSNKKNSSS.',
    '.SSSNNNNSSS.',
    '.SSSSSSSSSS.',
    '..SSSSSSSS..',
    '...SSSSSS...',
    '............'
  ] },
  { name: '雪人', rows: [
    '.....NN.....',
    '....NNNN....',
    '...SSSSSS...',
    '..SSSSSSSS..',
    '..SSKSSKSS..',
    '..SSSSSSSS..',
    '...SSSSSS...',
    '....SSSS....',
    '...SSSSSS...',
    '..SSSSSSSS..',
    '...SSOOSS...',
    '...SSSSSS...'
  ] },
  { name: '小鱼', rows: [
    '.....T......',
    '....TTT.....',
    '...OOOOO....',
    '..OOOOOOOT..',
    '..OOKOOOO...',
    '..OOOOOOO...',
    '...OOOOO....',
    '....SSS.....',
    '.....T......',
    '............',
    '............',
    '............'
  ] },
  { name: '花盆', rows: [
    '....RRRR....',
    '...RR..RR...',
    '..RR.YY.RR..',
    '.RRR.YY.RRR.',
    '..RR.YY.RR..',
    '....GYYG....',
    '.....GG.....',
    '..GG.GG.GG..',
    '.....GG.....',
    '...NNNNNN...',
    '..NNNNNNNN..',
    '..NNNNNNNN..'
  ] }
];

/* ---- 专家 15×15（5~6 色）---- */
PATTERNS[3] = [
  { name: '鲸鱼', rows: [
    '.......B.......',
    '......BBB......',
    '.....BBBBB.....',
    '..BBBBBBBBBBB..',
    '.BBBBBBBBBBBBB.',
    'BBBKBBBBBBBBBBB',
    'BBBBBBBBBBBBBBB',
    'BBBBBBBBBBBBBBB',
    'BBBBBBBBBBBBBBB',
    'BBBBBBBBBBBBBBB',
    '.BBBBBBBBBBBBB.',
    '..SSSSSSSSSSS..',
    '...SSSSSSSSS...',
    '.....SSSSS.....',
    '.......S.......'
  ] },
  { name: '向日葵', rows: [
    '..O...O...O....',
    '.OOOO.OOO.OOO..',
    '..OYYYNNNNNYYY.',
    '.OYYYONNNNOYYY.',
    '..OYYYNNNNNYYY.',
    '.OYYYYNNNYYYYY.',
    '..OOOO.OOOOO...',
    '.......GGG.....',
    '.......GG......',
    '.......GG......',
    '..GGG.GGG.GGG..',
    '.......GG......',
    '.......GG......',
    '......GGGG.....',
    '......GGGG.....'
  ] },
  { name: '帆船', rows: [
    '...........Y...',
    '..........YYY..',
    '...........Y...',
    '......RRRRR....',
    '.....RRRRRRR...',
    '....RRRRRRRRR..',
    '...RRRRRRRRRR..',
    '....SSSSSSS....',
    '.....SSSSS.....',
    '..NNNNNNNNNNN..',
    '.NNNNNNNNNNNNN.',
    '...............',
    'BB..BB..BB..BB.',
    'BBBBBB..BBBBBB.',
    '.BB..BB..BB..B.'
  ] },
  { name: '灯塔', rows: [
    '.......Y.......',
    '......YYY......',
    '.....YYYYY.....',
    '......KKK......',
    '.....KKKKK.....',
    '....SSSSSSS....',
    '...SSSSSSSSS...',
    '..SRRRRRRRRS...',
    '..SSSSSSSSSSS..',
    '...SRRRRRRS....',
    '...SSSSSSSSS...',
    '..SRRRRRRRRS...',
    '...SSSSSSSSS...',
    '....SSSSSSS....',
    '...BBBBBBBBB...'
  ] },
  { name: '熊猫', rows: [
    '..KK......KK.Y.',
    '.KSSK....KSSKYG',
    '.KSSK....KSSKGG',
    '..KK......KK.Y.',
    '...KKKKKKKKK.YG',
    '..KKKKKKKKKKKGG',
    '..KSSSSSSSSK.YG',
    '..KSSKSSSKSKK..',
    '..KSSKSSSKSKK.G',
    '..KSSSSSSSSK.GG',
    '..KSSSSRSSSSK.G',
    '..KSSSSSSSSK.GG',
    '...KSSSSSSSK..G',
    '....KKKKKKK..G.',
    '.....KKKKK..GG.'
  ] },
  { name: '松鼠', rows: [
    '.........NNN...',
    '........NNNNN..',
    '.......NNNNNN..',
    '......NNNNNNN..',
    '.....NNNNNNN...',
    '....NSSSNNN....',
    '...NNKSNNN.....',
    '...NNKSNNN.....',
    '...NNSSNN......',
    '..NNNSSNN......',
    '..NNNNNNNN.....',
    '...NNNNNN......',
    '....OOO........',
    '....OO.........',
    '...............'
  ] },
  { name: '热气球', rows: [
    '......YY.......',
    '.....Y..Y......',
    '....Y....Y.....',
    '...RRRRRRRRR...',
    '..RRRRRRRRRRR..',
    '.RRRRRRRRRRRRR.',
    'RRRRRRRRRRRRRRR',
    'TTTRRRRRRRRRBBB',
    'BBBBRRRRRRRBBBB',
    '.BBBBRRRRRBBBB.',
    '..BBBBBBBBBBB..',
    '...NNNNNNNNN...',
    '...NN.NN.NN....',
    '...NNNNNNNNN...',
    '....NN...NN....'
  ] },
  { name: '城堡', rows: [
    '..N..NNN..N....',
    '..R..RNR..R....',
    '..RNNNNNNNR....',
    '.RNNNNNNNNNNR..',
    '.RNNNNNNNNNNR..',
    '.RNYNNNNNNYNR..',
    '.RNYNNNNNNYNR..',
    '.RNNNNNNNNNNR..',
    '..NNNN..NNNN...',
    '..NNNN..NNNN...',
    '..NNNN..NNNN...',
    '..NNNNBBBNNN...',
    '..NNNN..NNNN...',
    '..NNNN..NNNN...',
    '..GGGG..GGGG...'
  ] },
  { name: '小猫', rows: [
    '...NN....NN....',
    '..NPN....NPN...',
    '..NPN....NPN...',
    '..NNNNNNNNNNN..',
    '..NNSSSSSSNNN..',
    '..NSSKSSSSKSN..',
    '..NSSKSSSSKSN..',
    '..NSSSSSSSSSN..',
    '..NSSSSRRSSSN..',
    '..NNSSSSSSNNN..',
    '...NNSSSSNN....',
    '....NNNNNN.....',
    '....NN..NN.....',
    '...NN....NN....',
    '...............'
  ] },
  { name: '螃蟹', rows: [
    '..S........S...',
    '..S........S...',
    '.RRRRRRRRRRRRR.',
    'ORRRRRRRRRRRRRO',
    'ORRRRRRRRRRRRRO',
    'ORRRRRRRRRRRRRO',
    'ORRKRRRRRRKRRRO',
    '.RRRRRRRRRRRRR.',
    '..RRRRRRRRRRR..',
    '...RRRRRRRRR...',
    '..K.K.K.K.K.K..',
    '.K...K...K...K.',
    'BBBBBBBBBBBBBBB',
    '.BBBBBBBBBBBBB.',
    '..BBBBBBBBBBB..'
  ] },
  { name: '恐龙', rows: [
    '.........GGG...',
    '........GGGG...',
    '.......GGGGG...',
    '......GGGGGG...',
    '.....GGGGGGG...',
    '....GGKGGGGG...',
    '...GGGGGGGGG...',
    '..GGGGGGGGGG...',
    '.GGGGGGGGGGG...',
    '.GGGGYGGGGGGGG.',
    'GGGGGGGGGGGGGGG',
    '.RRRRRRRRRRRRR.',
    '..GGG.GGG.GGG..',
    '..GG..GG..GG...',
    '.NN...NN...NN..'
  ] },
  { name: '蝴蝶', rows: [
    '..K.........K..',
    '...K.......K...',
    'SYYYYY...YYYYYS',
    'SYYYPPKKKPPYYYS',
    'YYYYPPKKKPPYYYY',
    'YYYYYPKKKPYYYYY',
    '.YYYYPKKKPYYYY.',
    '..YYYPKKKPYYY..',
    '...YYPKKKPYY...',
    '....YPKKKPY....',
    '.....PKKKP.....',
    '......KKK......',
    '...TT.KKK.TT...',
    '....T.KKK.T....',
    '...............'
  ] },
  { name: '猫头鹰', rows: [
    '...NN....NN....',
    '..NYYN...NYYN..',
    '..NYKY...YKYN..',
    '..NYYN...NYYN..',
    '...NNN...NNN...',
    '...NNNNNNNNNNNN',
    '..NNSSSSSSSSNN.',
    '..NSSSSSSSSSSN.',
    '..NSSSSSSSSSSN.',
    '..NNSSSSSSSSNN.',
    '...NNNNNNNNNNNN',
    '...NNN...NNN...',
    '..TTTTT...TTTT.',
    '.TTTTTTTTTTTTT.',
    '...............'
  ] },
  { name: '小汽车', rows: [
    '...............',
    '.......KKK.....',
    '.....KBBBBK....',
    '....RRRRRRR....',
    '..RRRRRRRRRRR..',
    '.RRRRRRRRRRRRR.',
    'YYRRRRRRRRRRRRY',
    '.KK.........KK.',
    '.KK.........KK.',
    '...............',
    '...............',
    'BBBBBBBBBBBBBBB',
    '.B..B..B..B..B.',
    'BBBBBBBBBBBBBBB',
    '...............'
  ] },
  { name: '机器人', rows: [
    '.......KK......',
    '..KKKKKKKKKKK..',
    '..KBBBSSSBBBK..',
    '..KSSSSSSSSSK..',
    '..KKKKRRKKKKK..',
    '...KSSSSSSSSK..',
    '.KKRRRRRRRRRKK.',
    '.KKRRRRRRRRRKK.',
    '.KKRRRRRRRRRKK.',
    '...KKRRRRKK....',
    '...KKRRRRKK....',
    '..KK..KK..KK...',
    '.KK....KK....KK',
    '..KK...KK...KK.',
    '...............'
  ] }
];

/* ================= 解析 / 校验 / 生成 ================= */

function parsePattern(p, expectN) {
  var errs = [];
  var n = p.rows.length;
  if (expectN && n !== expectN) {
    errs.push('行数 ' + n + ' ≠ 期望 ' + expectN);
  }
  var cells = [];
  for (var r = 0; r < n; r++) {
    var row = p.rows[r];
    if (row.length !== n) {
      errs.push('第 ' + (r + 1) + ' 行长度 ' + row.length + ' ≠ ' + n + '："' + row + '"');
      continue;
    }
    for (var c = 0; c < n; c++) {
      var ch = row.charAt(c);
      if (ch === '.') { cells.push(-2); continue; }
      var v = LETTERS[ch];
      if (v === undefined) {
        errs.push('第 ' + (r + 1) + ' 行出现未知颜色字母 "' + ch + '"');
        v = 0;
      }
      cells.push(v);
    }
  }
  return { cells: cells, n: n, errs: errs };
}

function fillRatio(cells) {
  var f = 0;
  for (var i = 0; i < cells.length; i++) { if (cells[i] >= 0) { f++; } }
  return f / cells.length;
}

function main() {
  var out = [];
  var accepted = [];
  var tierNames = Gen.TIER_NAMES;

  for (var t = 0; t < tierNames.length; t++) {
    var expectN = Gen.TIER_SIZE[t];
    var list = PATTERNS[t] || [];
    var okCount = 0, drop = [];
    out.push('==== ' + tierNames[t] + '（' + expectN + '×' + expectN + '）候选 ' + list.length + ' 个 ====');
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var parsed = parsePattern(p, expectN);
      var tag = tierNames[t] + ' ' + (i + 1) + ':' + p.name;
      if (parsed.errs.length) {
        drop.push(tag + ' → 图案非法: ' + parsed.errs.join('; '));
        continue;
      }
      var cells = parsed.cells;
      var colors = Gen.colorsOf(cells);
      var ratio = fillRatio(cells);
      var lv = { n: parsed.n, g: Gen.encodeGrid(cells) };
      var uniq = Gen.isUnique(lv);
      if (!uniq) {
        drop.push(tag + ' → 非唯一解（色 ' + colors.length + '，填充 ' +
          (ratio * 100).toFixed(0) + '%）');
        continue;
      }
      okCount++;
      if (okCount <= 10) {
        accepted.push({ n: parsed.n, g: lv.g, name: p.name });
      }
      out.push('  ✅ ' + p.name + '  色' + colors.length + '  填充 ' +
        (ratio * 100).toFixed(0) + '%' + (okCount <= 10 ? '' : '（备选，未采用）'));
    }
    for (var d = 0; d < drop.length; d++) { out.push('  ❌ ' + drop[d]); }
    out.push('  → 采用 ' + Math.min(okCount, 10) + ' / 10 关');
    if (okCount < 10) {
      out.push('  ⚠️ 该档候选不足 10 个，需要补图案！');
    }
  }

  /* ---- 汇总 ---- */
  out.push('');
  out.push('==== 汇总 ====');
  out.push('总关数 ' + accepted.length + '（期望 40）');
  var perTier = {};
  for (var a = 0; a < accepted.length; a++) {
    var tt = Gen.tierOf(a + 1);
    perTier[tt] = (perTier[tt] || 0) + 1;
  }
  for (var k in perTier) {
    out.push('  ' + tierNames[k] + '：' + perTier[k] + ' 关');
  }
  // 每档最大色数（档卡副标题用）
  for (var t2 = 0; t2 < tierNames.length; t2++) {
    var mx = 0, first = t2 * 10 + 1, last = first + 9;
    for (var lv2 = first; lv2 <= last && lv2 <= accepted.length; lv2++) {
      mx = Math.max(mx, Gen.colorsOf(Gen.decodeGrid(accepted[lv2 - 1].g)).length);
    }
    out.push('  ' + tierNames[t2] + ' 最大色数 ' + mx);
  }

  var txt = out.join('\n');
  fs.writeFileSync(path.join(root, 'tools/_picross_levels_out.txt'), txt, 'utf8');
  console.log(txt);

  if (accepted.length !== 40) {
    console.log('\n⚠️ 采用关数不是 40，不写回 js（先补图案库）');
    process.exit(2);
  }

  /* ---- 写回 js/game/picross.js ---- */
  var file = path.join(root, 'js/game/picross.js');
  var src = fs.readFileSync(file, 'utf8');
  var body = accepted.map(function (lv) {
    return "    { n: " + lv.n + ", g: '" + lv.g + "', name: '" + lv.name + "' },";
  }).join('\n');
  var re = /(  \/\/ __PICROSS_LEVELS_BEGIN__\n)([\s\S]*?)(  \/\/ __PICROSS_LEVELS_END__)/;
  if (!re.test(src)) {
    console.log('⚠️ 找不到 LEVELS 标记位，未写回');
    process.exit(3);
  }
  src = src.replace(re, function (m, a, b, c) {
    return a + '  var LEVELS = [\n' + body + '\n  ];\n' + c;
  });
  fs.writeFileSync(file, src, 'utf8');
  console.log('\n✅ 已写回 js/game/picross.js（' + accepted.length + ' 关）');

  /* ---- 写回后独立核对（vm 沙箱重新加载改过的文件）----
   * 不能直接 require：picross.js 是 IIFE，开头有 `if (BF.PicrossGen) return;`
   * 防重复加载——本进程里 BF 已经存在，再 require 会整段跳过、拿到空 LEVELS 的旧引用。
   * 用全新 vm 上下文跑一遍，才是"当成刚写完的文件第一次加载"的真实核对。 */
  var vm = require('vm');
  var sbox = { console: console };
  var vctx = vm.createContext(sbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/core/ns.js'), 'utf8'), vctx, { filename: 'ns.js' });
  vm.runInContext(fs.readFileSync(file, 'utf8'), vctx, { filename: 'picross.js' });
  var Gg = sbox.BF.PicrossGen;
  var bad = 0;
  if (Gg.LEVELS.length !== 40) { console.log('❌ LEVELS 数量 ' + Gg.LEVELS.length); bad++; }
  for (var v = 1; v <= 40; v++) {
    var lv3 = Gg.build(v);
    var cl = Gg.cluesFor(lv3.cells, lv3.n);
    if (!Gg.isUnique(lv3)) { console.log('❌ 第 ' + v + ' 关非唯一解'); bad++; }
    // 线索必须能还原出解本身（自洽）
    var sol = Gg.solveCount(lv3.cells.map(function () { return -1; }), lv3.n, cl.rows, cl.cols, 2);
    if (sol !== 1) { console.log('❌ 第 ' + v + ' 关解数 ' + sol); bad++; }
  }
  // 档位尺寸
  var sizes = [5, 10, 12, 15];
  for (var t3 = 0; t3 < 4; t3++) {
    var lv4 = Gg.build(t3 * 10 + 1);
    if (lv4.n !== sizes[t3]) { console.log('❌ 档 ' + t3 + ' 尺寸 ' + lv4.n); bad++; }
  }
  // 每日
  var daily = Gg.buildDaily();
  if (!daily.daily || daily.n !== 12) { console.log('❌ 每日关卡异常'); bad++; }
  console.log(bad === 0 ? '✅ 独立核对全部通过（40 关唯一解 / 档位尺寸 / 每日）' : '❌ 核对失败 ' + bad + ' 处');
  process.exit(bad === 0 ? 0 : 4);
}

main();
