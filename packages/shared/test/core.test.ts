import {describe,expect,it} from 'vitest';
import {COUNTRIES,distanceKm} from '../src/countries';
import {generateMaze,hasPath,movePosition} from '../src/maze';
describe('maze',()=>{it('is deterministic and solvable',()=>{const a=generateMaze(42),b=generateMaze(42);expect(a.cells).toEqual(b.cells);expect(hasPath(a)).toBe(true)});it('rejects walls and permits passages',()=>{const m=generateMaze(7,5,5),p=m.start;const results=(['up','down','left','right'] as const).map(d=>movePosition(m,p,d));expect(results.some(n=>n!==p)).toBe(true);expect(movePosition(m,p,'up')).toBe(p);expect(movePosition(m,p,'left')).toBe(p)})});
describe('distance',()=>it('calculates a plausible centroid distance',()=>{const us=COUNTRIES.find(c=>c.code==='US')!,kr=COUNTRIES.find(c=>c.code==='KR')!;expect(distanceKm(us,kr)).toBeGreaterThan(10000);expect(distanceKm(us,us)).toBe(0)}));
