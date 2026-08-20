import type { Cell, Direction, Maze, Position } from './index.js';

function rng(seed:number){let s=seed>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296}}
export function generateMaze(seed:number,width=13,height=9):Maze{
  const cells:Cell[][]=Array.from({length:height},()=>Array.from({length:width},()=>({n:true,e:true,s:true,w:true})));
  const seen=Array.from({length:height},()=>Array(width).fill(false)), random=rng(seed), stack:Position[]=[{x:0,y:0}]; seen[0][0]=true;
  const ds=[{dx:0,dy:-1,a:'n',b:'s'},{dx:1,dy:0,a:'e',b:'w'},{dx:0,dy:1,a:'s',b:'n'},{dx:-1,dy:0,a:'w',b:'e'}] as const;
  while(stack.length){const c=stack[stack.length-1];const options=ds.filter(d=>{const x=c.x+d.dx,y=c.y+d.dy;return x>=0&&y>=0&&x<width&&y<height&&!seen[y][x]});if(!options.length){stack.pop();continue}const d=options[Math.floor(random()*options.length)];const n={x:c.x+d.dx,y:c.y+d.dy};cells[c.y][c.x][d.a]=false;cells[n.y][n.x][d.b]=false;seen[n.y][n.x]=true;stack.push(n)}
  return {width,height,cells,start:{x:0,y:0},exit:{x:width-1,y:height-1},seed};
}
export function movePosition(maze:Maze,p:Position,d:Direction):Position{
  const wall=maze.cells[p.y]?.[p.x]?.[{up:'n',right:'e',down:'s',left:'w'}[d] as keyof Cell];if(wall!==false)return p;
  const delta={up:[0,-1],right:[1,0],down:[0,1],left:[-1,0]}[d];return{x:p.x+delta[0],y:p.y+delta[1]};
}
export function hasPath(maze:Maze):boolean{const q=[maze.start],seen=new Set(['0,0']);while(q.length){const p=q.shift()!;if(p.x===maze.exit.x&&p.y===maze.exit.y)return true;for(const d of ['up','right','down','left'] as Direction[]){const n=movePosition(maze,p,d),k=`${n.x},${n.y}`;if(!seen.has(k)){seen.add(k);q.push(n)}}}return false}
