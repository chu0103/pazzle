/**
 * photoAssets.js —— 内置照片清单（由 tools/process_photos.py 自动生成，勿手改）
 * 每张图已经过：居中裁正方 → 统一尺寸 → 提亮加对比 → 压体积。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});

  BF.PHOTO_ASSETS = [
    { src: 'assets/photo/p1.jpg', color: '#C79774', w: 720, h: 720 },
    { src: 'assets/photo/p2.jpg', color: '#F9DD92', w: 720, h: 720 },
    { src: 'assets/photo/p3.jpg', color: '#58A53B', w: 720, h: 720 },
    { src: 'assets/photo/p4.jpg', color: '#1D1C43', w: 720, h: 720 },
    { src: 'assets/photo/p5.jpg', color: '#745329', w: 720, h: 720 },
    { src: 'assets/photo/p6.jpg', color: '#65A5E1', w: 720, h: 720 },
  ];
})();
