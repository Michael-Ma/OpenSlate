// Maintenance only: run explicitly on a Mac with FFmpeg 8.1.1 and Pillow.
// Never imported by the tests. All pixels/audio are synthetic.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url)), temp = mkdtempSync(join(tmpdir(), 'openslate-format-fixtures-'));
const ffmpeg = process.env.U1_FIXTURE_FFMPEG_PATH ?? '/opt/homebrew/bin/ffmpeg';
const encode = (name, args) => execFileSync(ffmpeg, ['-nostdin', '-v', 'error', '-y', ...args, '-threads', '1', join(root, name)], { timeout: 60000 });
const hevc = ['-c:v', 'libx265', '-x265-params', 'log-level=error:pools=none:frame-threads=1:info=0'];
try {
  const still = ['-f', 'lavfi', '-i', 'testsrc2=s=320x180', '-frames:v', '1'];
  encode('image.avif', [...still, '-c:v', 'libsvtav1', '-svtav1-params', 'lp=1', '-f', 'avif']);
  encode('hevc-tile.mp4', [...still, ...hevc, '-tag:v', 'hvc1']);
  for (const [name, codec] of [['video-hevc.mp4', hevc], ['video-vp9.webm', ['-c:v', 'vp9']], ['video-av1.webm', ['-c:v', 'libsvtav1', '-svtav1-params', 'lp=1']]])
    encode(name, ['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=1', '-an', ...codec]);
  for (const [name, codec, muxer] of [['audio.mp3', 'mp3', 'mp3'], ['audio.weba', 'libopus', 'webm']])
    encode(name, ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-ac', '2', '-c:a', codec, '-f', muxer]);
  for (const [ext, codec, muxer] of [['mp4','libx264'],['mov','libx264'],['m4v','libx264','mp4'],['mkv','libx264'],['avi','mpeg4'],['mpeg','mpeg2video'],['mpg','mpeg2video'],['flv','flv'],['wmv','wmv2'],['3gp','h263']])
    encode(`video.${ext}`, ['-f','lavfi','-i',`testsrc2=s=${ext==='3gp'?'176x144':'320x180'}:r=30:d=1`,'-an','-c:v',codec,...(muxer?['-f',muxer]:[])]);
  for (const [ext, codec, muxer] of [['wav','pcm_s16le'],['m4a','aac'],['aac','aac','adts'],['flac','flac'],['ogg','vorbis'],['oga','vorbis','ogg'],['opus','opus','opus'],['aiff','pcm_s16be'],['aif','pcm_s16be','aiff']])
    encode(`audio.${ext}`, ['-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1','-ac','2','-c:a',codec,...(['vorbis','opus'].includes(codec)?['-strict','experimental']:[]),...(muxer?['-f',muxer]:[])]);
  for (const [ext, codec] of [['png','png'],['gif','gif'],['bmp','bmp'],['tiff','tiff']])
    encode(`basic.${ext}`, ['-f','lavfi','-i','testsrc2=s=1200x800','-frames:v','1','-c:v',codec]);
  encode('animated.gif', ['-f','lavfi','-i','testsrc2=s=320x180:r=2:d=1','-frames:v','2','-c:v','gif']);
  // Gzip stores the large uncompressed formats in a few KB, without changing
  // the upload bytes or requiring a media encoder when running the suite.
  for (const name of ['basic.bmp', 'basic.tiff', 'audio.wav', 'audio.aiff', 'audio.aif']) {
    writeFileSync(join(root, `${name}.gz`), gzipSync(readFileSync(join(root, name))));
    rmSync(join(root, name));
  }
  const source = join(temp, 'source.png');
  // No random noise: variant fixtures only test packaging/color modes. The
  // separate large noisy JPEG regression is still generated at test time.
  execFileSync(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1200x800', '-frames:v', '1', '-threads', '1', source]);
  execFileSync('python3', ['-c', `from PIL import Image
import sys,os
im=Image.open(sys.argv[1]).convert('RGB');root=sys.argv[2]
variants=[('jpeg-progressive.jpg','JPEG',{'progressive':True}),('jpeg-grayscale.jpg','JPEG',{'mode':'L'}),('jpeg-cmyk.jpg','JPEG',{'mode':'CMYK'}),('webp-lossy.webp','WEBP',{}),('webp-lossless.webp','WEBP',{'lossless':True}),('webp-animated.webp','WEBP',{'animated':True}),('tiff-multipage.tiff','TIFF',{'animated':True,'compression':'tiff_adobe_deflate'})]
for name,fmt,opts in variants:
  pic=im.convert(opts.pop('mode','RGB'));animated=opts.pop('animated',False)
  pic.save(os.path.join(root,name),format=fmt,save_all=animated,append_images=[Image.new(pic.mode,pic.size,'white')] if animated else [],**opts)
`, source, root]);
} finally { rmSync(temp, { recursive: true, force: true }); }
