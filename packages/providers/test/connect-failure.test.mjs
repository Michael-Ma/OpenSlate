import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import net from 'node:net';
import { once } from 'node:events';
import { connectFailureCode } from '../dist/connect-failure.js';
import { ViggleH3Provider } from '../dist/viggle-h3.js';
import { MiniMaxH3Provider } from '../dist/minimax-h3.js';

const viggle = {prompt:'Move slowly',quality:'low',durationSeconds:6,resolution:'480p',aspectRatio:'9:16',watermark:false};
const minimax = {prompt:'Move slowly',durationSeconds:6,resolution:'768P',firstFrame:{url:'https://fixture.invalid/frame.png',sha256:'a'.repeat(64),width:941,height:1672,byteLength:1024,mediaType:'image/png'}};
async function server(t, handler) {
 const sockets=new Set(), s=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));handler(socket);});
 s.listen(0,'127.0.0.1');await once(s,'listening');
 t.after(async()=>{for(const socket of sockets)socket.destroy(); await new Promise(r=>s.close(r));});
 return s.address().port;
}
async function adapters(target, expected, code) {
 for(const [Provider,input,extra] of [[ViggleH3Provider,viggle,{}],[MiniMaxH3Provider,minimax,{model:'MiniMax-H3'}]]) {
  let observed;
  const provider=new Provider({apiKey:'offline-key',timeoutMs:20000,...extra,fetch:async(_url,init)=>{
   try{return await fetch(target,init);}catch(error){observed=error;throw error;}
  }});
  const result=await provider.submit(input);
  assert.equal(result.kind,expected,JSON.stringify(result));
  if(code){assert.equal(connectFailureCode(observed),code); assert.equal(result.certainty,'not_accepted');assert.equal(result.error.code,`${Provider === MiniMaxH3Provider ? "H3_" : ""}CONNECT_${code}`);}
  else assert.equal(connectFailureCode(observed),undefined);
 }
}
test('fetch connection-refused is definitive no-submit in both H3 adapters',async t=>{
 const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const port=s.address().port;await new Promise(r=>s.close(r));
 await adapters(`http://127.0.0.1:${port}`,'rejected','ECONNREFUSED');
});
for(const code of ['ENOTFOUND','EAI_AGAIN'])test(`fetch DNS ${code} is definitive no-submit with offline lookup`,async t=>{
 const before=dns.lookup;t.after(()=>{dns.lookup=before;});
 dns.lookup=(host,options,callback)=>{assert.equal(host,'offline-dns.invalid');callback(Object.assign(new Error('fixture DNS failure'),{code,syscall:'getaddrinfo'}));};
 await adapters('http://offline-dns.invalid','rejected',code);
});
test('fetch TLS handshake failure before HTTP is definitive no-submit',async t=>{
 const port=await server(t,socket=>socket.once('data',()=>socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')));
 await adapters(`https://127.0.0.1:${port}`,'rejected','ERR_SSL_PACKET_LENGTH_TOO_LONG');
});
test('fetch TLS connect timeout is definitive no-submit (loopback silent handshake)',async t=>{
 const port=await server(t,()=>{});
 await adapters(`https://127.0.0.1:${port}`,'rejected','UND_ERR_CONNECT_TIMEOUT');
});
test('a reset after the request connects remains unknown in both H3 adapters',async t=>{
 let bodies=0;const port=await server(t,socket=>socket.once('data',()=>{bodies++;socket.destroy();}));
 await adapters(`http://127.0.0.1:${port}`,'unknown');assert.equal(bodies,2);
});
test('ambiguous resets, aborts, generic timeouts and mixed connection aggregates never authorize retry',()=>{
 for(const code of ['ECONNRESET','UND_ERR_SOCKET','ETIMEDOUT','UND_ERR_HEADERS_TIMEOUT','ABORT_ERR','ERR_SSL_PACKET_LENGTH_TOO_LONG','ERR_SSL_WRONG_VERSION_NUMBER','CERT_HAS_EXPIRED'])
  assert.equal(connectFailureCode(new TypeError('fetch failed',{cause:Object.assign(new Error(),{code})})),undefined);
 const safe=()=>Object.assign(new Error(),{code:'ECONNREFUSED'});
 assert.equal(connectFailureCode(new TypeError('fetch failed',{cause:new AggregateError([safe(),safe()])})),'ECONNREFUSED');
 assert.equal(connectFailureCode(new TypeError('fetch failed',{cause:new AggregateError([safe(),new Error()])})),undefined);
});
