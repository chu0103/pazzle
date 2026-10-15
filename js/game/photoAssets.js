/**
 * photoAssets.js —— 内置照片清单（由 tools/process_photos.py 自动生成，勿手改）
 * 每张图已经过：居中裁正方 → 统一尺寸 → 提亮加对比 → 压体积。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});

  BF.PHOTO_ASSETS = [
    { src: 'assets/photo/p1.jpg', color: '#C9AE8F', w: 600, h: 600 },
    { src: 'assets/photo/p2.jpg', color: '#BE9077', w: 600, h: 600 },
    { src: 'assets/photo/p3.jpg', color: '#FFFFFD', w: 600, h: 600 },
    { src: 'assets/photo/p4.jpg', color: '#CBB097', w: 600, h: 600 },
    { src: 'assets/photo/p5.jpg', color: '#FF1A0E', w: 600, h: 600 },
    { src: 'assets/photo/p6.jpg', color: '#786469', w: 600, h: 600 },
    { src: 'assets/photo/p7.jpg', color: '#BAA58B', w: 600, h: 600 },
  ];
})();
