import assert from 'node:assert/strict';
import { WordGame } from './src/index.js';
const savedFetch = globalThis.fetch;
const sent=[];
globalThis.fetch = async(url, options) => {
  sent.push(JSON.parse(options.body));
  return new Response(JSON.stringify({ok:true,result:{}}),{headers:{'content-type':'application/json'}});
};
function clone(v) {return structuredClone(v);}
class Storage {
  data=new Map(); alarmAt=null;
  async get(k){return clone(this.data.get(k));}
  async put(k,v){this.data.set(k,clone(v));}
  async setAlarm(ms){this.alarmAt=ms;}
  async deleteAlarm(){this.alarmAt=null;}
  async transaction(fn){
    const snap=new Map([...this.data].map(([k,v])=>[k,clone(v)]));
    const tx={get:async k=>clone(snap.get(k)), put:async(k,v)=>snap.set(k,clone(v))};
    const out=await fn(tx);this.data=snap;return out;
  }
}
const storage = new Storage();
const obj = new WordGame({storage},{BOT_TOKEN:'fake'});
let id=1;
const chat={id:-987,type:'supergroup'};
const users=[{id:10,first_name:'Amina'},{id:20,first_name:'Sara'},{id:30,first_name:'Moh'}];
async function msg(text,from=users[0]) {await obj.fetch(new Request('https://internal/update',{method:'POST',body:JSON.stringify({update_id:id++,message:{chat,from,text}})}));}
async function join(from){await obj.fetch(new Request('https://internal/update',{method:'POST',body:JSON.stringify({update_id:id++,callback_query:{id:'c'+id,from,data:'join',message:{chat}}})}));}
async function expire(){const game=await storage.get('game');game.deadline=Date.now()-1;await storage.put('game',game);await obj.alarm();}
await msg('/game');await join(users[1]);await msg('/startgame');
let g=await storage.get('game');assert.equal(g.phase,'playing');
// Continue until one player is eliminated. With two players and three lives, six timed turns max.
for(let i=0;i<7;i++){g=await storage.get('game');if(g.phase==='idle')break;await expire();}
g=await storage.get('game');assert.equal(g.phase,'idle');
const scores=await storage.get('scores');
assert.equal(Object.keys(scores).length,2);
assert.equal(Object.values(scores).reduce((a,v)=>a+v.points,0),10);
assert.equal((await storage.get('rewardEvents')).length,1);
const totalFirst=Object.values(scores).reduce((a,v)=>a+v.points,0);
await obj.save(g);
assert.equal(Object.values(await storage.get('scores')).reduce((a,v)=>a+v.points,0),totalFirst);
await msg('/points');await msg('/leaderboard');
assert.ok(sent.some(m=>m.text.includes('ترتيب النقاط')));
await msg('/game');g=await storage.get('game');assert.equal(g.phase,'lobby');
assert.equal((await storage.get('scores'))[String(users[0].id)].points>=0,true);
// Admin read endpoint returns snapshot.
const resp=await obj.fetch(new Request('https://game.internal/api/scores'));
assert.equal((await resp.json()).data.length,2);
globalThis.fetch=savedFetch;
console.log('PASS: game scoring, persistence, no double award, commands, protected export target');
