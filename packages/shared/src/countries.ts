import type { Country } from './index.js';

export const COUNTRIES: Country[] = [
  {code:'AR',name:'Argentina',city:'Buenos Aires',lat:-34.61,lon:-58.38},{code:'AU',name:'Australia',city:'Canberra',lat:-35.28,lon:149.13},
  {code:'BR',name:'Brazil',city:'Brasília',lat:-15.79,lon:-47.88},{code:'CA',name:'Canada',city:'Ottawa',lat:45.42,lon:-75.70},
  {code:'CN',name:'China',city:'Beijing',lat:39.90,lon:116.41},{code:'EG',name:'Egypt',city:'Cairo',lat:30.04,lon:31.24},
  {code:'FR',name:'France',city:'Paris',lat:48.86,lon:2.35},{code:'DE',name:'Germany',city:'Berlin',lat:52.52,lon:13.41},
  {code:'IN',name:'India',city:'New Delhi',lat:28.61,lon:77.21},{code:'ID',name:'Indonesia',city:'Jakarta',lat:-6.21,lon:106.85},
  {code:'JP',name:'Japan',city:'Tokyo',lat:35.68,lon:139.69},{code:'KE',name:'Kenya',city:'Nairobi',lat:-1.29,lon:36.82},
  {code:'MX',name:'Mexico',city:'Mexico City',lat:19.43,lon:-99.13},{code:'NG',name:'Nigeria',city:'Abuja',lat:9.08,lon:7.40},
  {code:'NO',name:'Norway',city:'Oslo',lat:59.91,lon:10.75},{code:'ZA',name:'South Africa',city:'Pretoria',lat:-25.75,lon:28.19},
  {code:'KR',name:'South Korea',city:'Seoul',lat:37.57,lon:126.98},{code:'ES',name:'Spain',city:'Madrid',lat:40.42,lon:-3.70},
  {code:'GB',name:'United Kingdom',city:'London',lat:51.51,lon:-0.13},{code:'US',name:'United States',city:'Washington, D.C.',lat:38.91,lon:-77.04}
];
export const countryByCode = (code: string) => COUNTRIES.find(c => c.code === code);
export function distanceKm(a: Country, b: Country): number {
  const rad = (v:number) => v * Math.PI / 180, r = 6371;
  const dLat=rad(b.lat-a.lat), dLon=rad(b.lon-a.lon);
  const h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
  return Math.round(2*r*Math.asin(Math.sqrt(h)));
}
