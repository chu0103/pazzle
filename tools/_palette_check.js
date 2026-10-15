/**
 * _palette_check.js —— 调色板色差体检（CIEDE2000）
 *
 * 用途：给定一组 hex，算出所有两两色差 ΔE00，按小到大列出。
 * ΔE00 经验阈值（本仓库口径）：
 *   < 10  太相近，玩家会混淆（本次用户的投诉点）
 *   10~18 偏近，勉强可分但不理想
 *   ≥ 18  清晰可分
 *
 * 用法：node tools/_palette_check.js
 * 直接改下面 PALETTES 里的候选，跑一遍对比。
 */
'use strict';

function hex2rgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function srgb2lab(rgb) {
  var v = rgb.map(function (c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  // sRGB D65 -> XYZ
  var X = (v[0] * 0.4124564 + v[1] * 0.3575761 + v[2] * 0.1804375) / 0.95047;
  var Y = (v[0] * 0.2126729 + v[1] * 0.7151522 + v[2] * 0.0721750) / 1.00000;
  var Z = (v[0] * 0.0193339 + v[1] * 0.1191920 + v[2] * 0.9503041) / 1.08883;
  function f(t) { return t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116); }
  var fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function de2000(lab1, lab2) {
  var L1 = lab1[0], a1 = lab1[1], b1 = lab1[2];
  var L2 = lab2[0], a2 = lab2[1], b2 = lab2[2];
  var kL = 1, kC = 1, kH = 1;
  var C1 = Math.sqrt(a1 * a1 + b1 * b1), C2 = Math.sqrt(a2 * a2 + b2 * b2);
  var Cbar = (C1 + C2) / 2;
  var G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))));
  var a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  var C1p = Math.sqrt(a1p * a1p + b1 * b1), C2p = Math.sqrt(a2p * a2p + b2 * b2);
  var h1p = Math.atan2(b1, a1p) * 180 / Math.PI; if (h1p < 0) { h1p += 360; }
  var h2p = Math.atan2(b2, a2p) * 180 / Math.PI; if (h2p < 0) { h2p += 360; }
  var dLp = L2 - L1;
  var dCp = C2p - C1p;
  var dhp;
  if (C1p * C2p === 0) { dhp = 0; }
  else if (Math.abs(h2p - h1p) <= 180) { dhp = h2p - h1p; }
  else if (h2p - h1p > 180) { dhp = h2p - h1p - 360; }
  else { dhp = h2p - h1p + 360; }
  var dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * Math.PI / 360);
  var Lbarp = (L1 + L2) / 2;
  var Cbarp = (C1p + C2p) / 2;
  var hbarp;
  if (C1p * C2p === 0) { hbarp = h1p + h2p; }
  else if (Math.abs(h1p - h2p) <= 180) { hbarp = (h1p + h2p) / 2; }
  else if (h1p + h2p < 360) { hbarp = (h1p + h2p + 360) / 2; }
  else { hbarp = (h1p + h2p - 360) / 2; }
  var T = 1 - 0.17 * Math.cos((hbarp - 30) * Math.PI / 180)
            + 0.24 * Math.cos((2 * hbarp) * Math.PI / 180)
            + 0.32 * Math.cos((3 * hbarp + 6) * Math.PI / 180)
            - 0.20 * Math.cos((4 * hbarp - 63) * Math.PI / 180);
  var dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  var RC = 2 * Math.sqrt(Math.pow(Cbarp, 7) / (Math.pow(Cbarp, 7) + Math.pow(25, 7)));
  var SL = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  var SC = 1 + 0.045 * Cbarp;
  var SH = 1 + 0.015 * Cbarp * T;
  var RT = -Math.sin(2 * dTheta * Math.PI / 360) * RC;
  return Math.sqrt(
    Math.pow(dLp / (kL * SL), 2) +
    Math.pow(dCp / (kC * SC), 2) +
    Math.pow(dHp / (kH * SH), 2) +
    RT * (dCp / (kC * SC)) * (dHp / (kH * SH))
  );
}

var PALETTES = {
  '旧·初版（已弃用 · 绿/青绿 ΔE00 11.4）': [
    ['红', '#E63946'], ['橙', '#F4820B'], ['黄', '#E9BC00'], ['绿', '#2EA44F'],
    ['青', '#06AED7'], ['蓝', '#2D6CDF'], ['紫', '#8B3DF5'], ['粉', '#FF5DA2'],
    ['青绿', '#0FA37F'], ['棕', '#8A5A2D']
  ],
  '候选B': [
    ['红', '#E13B36'], ['橙', '#F5821F'], ['黄', '#F7CE1B'], ['绿', '#3FA34D'],
    ['青', '#3FC6DF'], ['蓝', '#2A55D4'], ['紫', '#A33BE8'], ['粉', '#FF5FA8'],
    ['青绿', '#0B7A72'], ['棕', '#7C4A1E']
  ],
  '第 1 轮修复（已弃用 · 仍有两个绿 · ΔE00 24.3）': [
    ['红', '#E13B36'], ['橙', '#F5821F'], ['黄', '#F2C400'], ['绿', '#3FA34D'],
    ['青', '#1FB8D6'], ['蓝', '#1F56CE'], ['紫', '#B03FDD'], ['粉', '#FF5FA8'],
    ['青绿', '#0B7A72'], ['棕', '#7C4A1E']
  ],
  '★当前（cipher / rush 已采用 · 去青绿加中性灰）': [
    ['红', '#E13B36'], ['橙', '#F5821F'], ['黄', '#F2C400'], ['绿', '#3FA34D'],
    ['青', '#1FB8D6'], ['蓝', '#1F56CE'], ['紫', '#B03FDD'], ['粉', '#FF5FA8'],
    ['灰', '#7A828E'], ['棕', '#7C4A1E']
  ],
  '候选C（✅ 已采用 = 中性灰）': [
    ['红', '#E13B36'], ['橙', '#F5821F'], ['黄', '#F2C400'], ['绿', '#3FA34D'],
    ['青', '#1FB8D6'], ['蓝', '#1F56CE'], ['紫', '#B03FDD'], ['粉', '#FF5FA8'],
    ['灰', '#7A828E'], ['棕', '#7C4A1E']
  ],
  '候选D（换掉青绿→玫红）': [
    ['红', '#E13B36'], ['橙', '#F5821F'], ['黄', '#F2C400'], ['绿', '#3FA34D'],
    ['青', '#1FB8D6'], ['蓝', '#1F56CE'], ['紫', '#B03FDD'], ['粉', '#FF5FA8'],
    ['玫红', '#C2185B'], ['棕', '#7C4A1E']
  ],
  '候选E（换掉青绿→靛蓝）': [
    ['红', '#E13B36'], ['橙', '#F5821F'], ['黄', '#F2C400'], ['绿', '#3FA34D'],
    ['青', '#1FB8D6'], ['蓝', '#1F56CE'], ['紫', '#B03FDD'], ['粉', '#FF5FA8'],
    ['靛', '#3D4FC4'], ['棕', '#7C4A1E']
  ],
  'bottle 现有': [
    ['红', '#E63946'], ['蓝', '#2D6CDF'], ['绿', '#2EA44F'], ['黄', '#F2C200'],
    ['紫', '#8B3DF5'], ['橙', '#FB8B24'], ['青', '#06AED7'], ['粉', '#FF5DA2'],
    ['棕', '#8B5A2B'], ['柠', '#B5E61D']
  ],
  'rush 现有（=旧 cipher 表）': [
    ['红', '#E63946'], ['橙', '#F4820B'], ['黄', '#E9BC00'], ['绿', '#2EA44F'],
    ['青', '#06AED7'], ['蓝', '#2D6CDF'], ['紫', '#8B3DF5'], ['粉', '#FF5DA2'],
    ['青绿', '#0FA37F'], ['棕', '#8A5A2D']
  ]
};

function report() {
  Object.keys(PALETTES).forEach(function (name) {
    var pal = PALETTES[name];
    var labs = pal.map(function (p) { return srgb2lab(hex2rgb(p[1])); });
    var pairs = [];
    for (var i = 0; i < pal.length; i++) {
      for (var j = i + 1; j < pal.length; j++) {
        pairs.push({ a: pal[i][0], b: pal[j][0], d: de2000(labs[i], labs[j]) });
      }
    }
    pairs.sort(function (x, y) { return x.d - y.d; });
    console.log('\n=== ' + name + ' ===');
    console.log('最小 ΔE00 = ' + pairs[0].d.toFixed(1) + '  (' + pairs[0].a + ' / ' + pairs[0].b + ')');
    pairs.slice(0, 8).forEach(function (p) {
      var tag = p.d < 10 ? '  ❌太近' : (p.d < 18 ? '  ⚠️偏近' : '  ✔');
      console.log('  ΔE00 ' + p.d.toFixed(1).padStart(5) + '  ' + p.a + '-' + p.b + tag);
    });
  });
}

// 供 test/*.verify.js 复用同一套色差口径（单一真源）；被 require 时不自动打印。
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { hex2rgb: hex2rgb, srgb2lab: srgb2lab, de2000: de2000, PALETTES: PALETTES };
}
if (typeof require !== 'undefined' && require.main === module) { report(); }
