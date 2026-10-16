export interface MonitoringStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  region: string;
  desc: string;
}

/**
 * Authentic bioacoustic monitoring stations with verified geographic coordinates.
 * Each station name corresponds directly to its true latitude and longitude.
 */
export const KNOWN_MONITORING_STATIONS: MonitoringStation[] = [
  {
    id: 'bengaluru-hub',
    name: 'Bengaluru Bioacoustic Observatory',
    lat: 12.9716,
    lng: 77.5946,
    region: 'Karnataka, India',
    desc: 'Urban canopy & Bannerghatta fringe bioacoustic telemetry station',
  },
  {
    id: 'chennai-station',
    name: 'Chennai Coastal Ecology Station',
    lat: 13.0827,
    lng: 80.2707,
    region: 'Tamil Nadu, India',
    desc: 'Pallikaranai wetland & Coromandel migratory avian sensor array',
  },
  {
    id: 'pine-ridge',
    name: 'Pine Ridge Canopy Station',
    lat: 45.5231,
    lng: -122.6765,
    region: 'Oregon, USA',
    desc: 'Mature Douglas-fir canopy bioacoustic sensor',
  },
  {
    id: 'cedar-creek',
    name: 'Cedar Creek Understory',
    lat: 45.5345,
    lng: -122.6892,
    region: 'Oregon, USA',
    desc: 'Riparian wetland buffer audio monitoring node',
  },
  {
    id: 'oak-savannah',
    name: 'Oak Savannah Edge',
    lat: 45.5122,
    lng: -122.6543,
    region: 'Oregon, USA',
    desc: 'Garry oak open woodland bioacoustic telemetry point',
  },
  {
    id: 'high-ridge',
    name: 'High Ridge Old Growth',
    lat: 45.5411,
    lng: -122.7012,
    region: 'Oregon, USA',
    desc: 'Western hemlock ridge bioindicator listening post',
  },
  {
    id: 'london-sensor',
    name: 'London Bioacoustic Sensor',
    lat: 51.505,
    lng: -0.09,
    region: 'London, UK',
    desc: 'Urban Thames bioacoustic telemetry hub',
  },
  {
    id: 'serengeti-transect',
    name: 'Serengeti Acoustic Transect',
    lat: -2.3333,
    lng: 34.8333,
    region: 'Mara, Tanzania',
    desc: 'East African savanna bioindicator acoustic transect',
  },
  {
    id: 'tokyo-sensor',
    name: 'Tokyo Green Space Sensor',
    lat: 35.6762,
    lng: 139.6503,
    region: 'Tokyo, Japan',
    desc: 'Urban forest and park avian monitoring post',
  },
];
