// Portrait options a player may pick. The client draws these (LOOK_OPTS in public/index.html, kept identical;
// test/room.test.mjs checks they match). A look travels as
// "v2.skin.hair.style.beard.glasses.marks.pierce.acc.hat"; the older "skin.hair.style.extra" form is still accepted.
export const LOOK_OPTS = {"skin":["#fbe4d6","#f7d7c4","#f4d0b5","#f0c8a4","#eec19a","#e6b58e","#ddb088","#d9a77c","#cf9a6e","#c89066","#bd8459","#b07a54","#a26c47","#94603f","#87563a","#784a32","#6b412c","#5e3826","#503021","#43281c","#38221a","#2d1c15"],"hair":["#120c0a","#241713","#36231a","#4c3022","#64402a","#7d4b2c","#8e3a22","#b5532b","#cf7a45","#9c7a4c","#c9a063","#e2c690","#efe3c4","#6e6a66","#9b9894","#c8c6c3","#f1eee8","#e48aa8","#9f80d8","#4f7fd0","#3a9e94","#7bae4f","#c8304a"],"style":["bald","receding","buzz","lineup","caesar","taper","crop","undercut","waves","wavefade","curltop","sponge","short","spiky","messy","side","slick","quiff","mullet","pixie","bob","lob","shag","long","longside","curtain","halfup","sidebraid","wavy","curls","coils","afro","puff","puffs","locs","locsfade","locslong","braids","cornrows","twists","bantu","bun","topknot","ponytail","pigtails","hijab","wrap"],"beard":["none","stubble","moustache","goatee","short","full"],"glasses":["none","round","square","cateye","half","shades"],"marks":"bfglmv","pierce":["none","studs","hoops","drops","cuff","nosestud","septum"],"acc":["none","clip","flower","headband","bow","beads","sticks"],"hat":["none","beanie","cap","bucket","headphones"]};

const OLD = /^[0-5]\.[0-6]\.(bob|short|long|bun|curls|puff)\.(none|clip|glasses|freckles|hoops|sticks)$/;

export function cleanLook(v) {
  const s = String(v ?? '');
  if (s.length > 80) return '';
  if (OLD.test(s)) return s;
  const p = s.split('.');
  if (p.length !== 10 || p[0] !== 'v2') return '';
  const [, sk, hr, st, bd, gl, mk, pc, ac, ht] = p, L = LOOK_OPTS;
  const idx = (x, n) => /^\d{1,2}$/.test(x) && +x < n;
  if (!idx(sk, L.skin.length) || !idx(hr, L.hair.length)) return '';
  if (!L.style.includes(st) || !L.beard.includes(bd) || !L.glasses.includes(gl) || !L.pierce.includes(pc) || !L.acc.includes(ac) || !L.hat.includes(ht)) return '';
  if (mk !== '-' && (!/^[bfglmv]{1,6}$/.test(mk) || new Set(mk).size !== mk.length)) return '';
  return s;
}
