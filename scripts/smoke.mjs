import { io } from 'socket.io-client';
const url=process.env.SMOKE_URL||'http://127.0.0.1:3000',a=io(url),b=io(url),clients=[a,b];
const once=(s,event)=>new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error(`Timed out: ${event}`)),15000);s.once(event,v=>{clearTimeout(t);resolve(v)})});
await Promise.all(clients.map(s=>once(s,'connect')));const matches=clients.map(s=>once(s,'matched'));a.emit('joinQueue',{countryCode:'US'});b.emit('joinQueue',{countryCode:'KR'});const states=await Promise.all(matches);if(states[0].roomId!==states[1].roomId||states[0].role===states[1].role)throw new Error('Invalid role assignment');
const runner=states[0].role==='runner'?a:b,guide=runner===a?b:a;await Promise.all(clients.map(s=>new Promise(resolve=>s.on('state',v=>v.phase==='playing'&&resolve(v)))));
const signal=once(runner,'signal');guide.emit('signal',{direction:'right'});if((await signal).direction!=='right')throw new Error('Signal was not delivered');
const maze=states[0].maze,dirs=[['up',0,-1,'n'],['right',1,0,'e'],['down',0,1,'s'],['left',-1,0,'w']],q=[[maze.start,[]]],seen=new Set(['0,0']);let route;
while(q.length){const[p,path]=q.shift();if(p.x===maze.exit.x&&p.y===maze.exit.y){route=path;break}for(const[d,dx,dy,wall]of dirs){if(maze.cells[p.y][p.x][wall])continue;const n={x:p.x+dx,y:p.y+dy},k=`${n.x},${n.y}`;if(!seen.has(k)){seen.add(k);q.push([n,[...path,d]])}}}
const success=Promise.all(clients.map(s=>new Promise(resolve=>s.on('state',v=>v.phase==='success'&&resolve(v)))));for(const direction of route){runner.emit('move',{direction});await new Promise(r=>setTimeout(r,80))}const won=await success;if(!won.every(v=>v.position.x===maze.exit.x&&v.position.y===maze.exit.y))throw new Error('Clients did not share win state');
clients.forEach(s=>s.disconnect());console.log(`Smoke test passed: two clients, ${route.length} authoritative moves, shared success.`);
