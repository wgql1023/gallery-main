// Blurhash 编码器（规格参考公开的 blurhash 算法说明，组件 4×3）
// 供上传流水线生成加载占位图；配套最小解码器用于单测往返校验。

const CHAR83 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

function srgbToLinear(v) {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v) {
  const x = Math.max(0, Math.min(1, v));
  return x <= 0.0031308 ? x * 12.92 * 255 + 0.5 : (1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255 + 0.5;
}

function signPow(v, exp) {
  return Math.sign(v) * Math.pow(Math.abs(v), exp);
}

function encode83(value, length) {
  let out = '';
  for (let i = 1; i <= length; i++) {
    const digit = Math.floor(value / Math.pow(83, length - i)) % 83;
    out += CHAR83[digit];
  }
  return out;
}

/**
 * @param {Uint8Array|number[]} pixels RGB 三通道像素
 * @param {number} width @param {number} height
 * @param {number} cx 横向组件数(1-9) @param {number} cy 纵向组件数(1-9)
 * @returns {string} blurhash 字符串
 */
export function blurhashEncode(pixels, width, height, cx = 4, cy = 3) {
  const linear = new Float64Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    linear[i * 3] = srgbToLinear(pixels[i * 3]);
    linear[i * 3 + 1] = srgbToLinear(pixels[i * 3 + 1]);
    linear[i * 3 + 2] = srgbToLinear(pixels[i * 3 + 2]);
  }

  const factors = [];
  for (let j = 0; j < cy; j++) {
    for (let i = 0; i < cx; i++) {
      const norm = i === 0 && j === 0 ? 1 : 2;
      let r = 0, g = 0, b = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const basis = norm * Math.cos((Math.PI * i * x) / width) * Math.cos((Math.PI * j * y) / height);
          const px = (y * width + x) * 3;
          r += basis * linear[px];
          g += basis * linear[px + 1];
          b += basis * linear[px + 2];
        }
      }
      const scale = 1 / (width * height);
      factors.push([r * scale, g * scale, b * scale]);
    }
  }

  const dc = factors[0];
  const ac = factors.slice(1);

  let actualMax = 0;
  for (const f of ac) {
    for (const v of f) actualMax = Math.max(actualMax, Math.abs(v));
  }
  const quantMax = actualMax > 0 ? Math.max(0, Math.min(82, Math.floor(actualMax * 166 - 0.5))) : 0;
  const maximumValue = (quantMax + 1) / 166;

  const dcValue = (Math.round(linearToSrgb(dc[0])) << 16) + (Math.round(linearToSrgb(dc[1])) << 8) + Math.round(linearToSrgb(dc[2]));

  let hash = encode83((cx - 1) + (cy - 1) * 9, 1);
  hash += encode83(quantMax, 1);
  hash += encode83(dcValue, 4);
  for (const f of ac) {
    const q = (v) => Math.max(0, Math.min(18, Math.floor(9.9 * signPow(v / maximumValue, 0.5) + 9.5)));
    hash += encode83((q(f[0]) * 19 + q(f[1])) * 19 + q(f[2]), 2); // 三分量打包为 2 字符
  }
  return hash;
}

/** 最小解码器（单测往返校验用）：返回 width×height 的 RGB 像素 */
export function blurhashDecode(hash, width, height) {
  const sizeFlag = CHAR83.indexOf(hash[0]);
  const cy = Math.floor(sizeFlag / 9) + 1;
  const cx = (sizeFlag % 9) + 1;
  const quantMax = CHAR83.indexOf(hash[1]);
  const maxVal = (quantMax + 1) / 166;

  const dcValue = decode83(hash, 2, 6);
  const dc = [
    srgbToLinear(Math.floor(dcValue / 65536) % 256),
    srgbToLinear(Math.floor(dcValue / 256) % 256),
    srgbToLinear(dcValue % 256),
  ];

  const ac = [];
  for (let i = 6; i < hash.length; i += 2) {
    ac.push(decodeAc(decode83(hash, i, i + 2), maxVal));
  }
  const colors = [dc, ...ac];

  const out = new Uint8Array(width * height * 3);
  let idx = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < cy; j++) {
        for (let i = 0; i < cx; i++) {
          const basis = Math.cos((Math.PI * i * x) / width) * Math.cos((Math.PI * j * y) / height);
          const f = colors[j * cx + i];
          r += f[0] * basis;
          g += f[1] * basis;
          b += f[2] * basis;
        }
      }
      out[idx++] = linearToSrgb(r);
      out[idx++] = linearToSrgb(g);
      out[idx++] = linearToSrgb(b);
    }
  }
  return out;
}

function decode83(str, start, end) {
  let v = 0;
  for (let i = start; i < end; i++) v = v * 83 + CHAR83.indexOf(str[i]);
  return v;
}

function decodeAc(value, maxVal) {
  const qR = Math.floor(value / (19 * 19));
  const qG = Math.floor(value / 19) % 19;
  const qB = value % 19;
  const p = (q) => signPow((q - 9) / 9, 2) * maxVal;
  return [p(qR), p(qG), p(qB)];
}
