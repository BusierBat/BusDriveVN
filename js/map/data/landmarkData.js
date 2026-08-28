// js/map/data/landmarkData.js
export const landmarks = [
  {
    id: 'benxe_tuyhoa',
    type: 'bus_station',
    name: 'Bến xe Nam Tuy Hòa',
    position: { x: 0, y: 0, z: 0 },
    size: { width: 150, height: 18, depth: 100 },
    parkingSlots: 30
  },
  {
    id: 'dailanh_stop',
    type: 'rest_stop',
    name: 'Trạm dừng chân Đại Lãnh',
    position: { x: 2280, y: 0, z: -1860 },
    size: { width: 80, height: 10, depth: 50 }
  },
  {
    id: 'phanrang_stop',
    type: 'rest_stop',
    name: 'Trạm dừng Phan Rang',
    position: { x: 5950, y: 0, z: -5160 },
    size: { width: 80, height: 10, depth: 50 }
  },
  {
    id: 'petrolimex_station',
    type: 'gas_station',
    name: 'Petrolimex Bình Thuận',
    position: { x: 7850, y: 0, z: -6760 },
    size: { width: 45, height: 8, depth: 30 }
  },
  {
    id: 'caotoc_rest',
    type: 'rest_stop',
    name: 'Trạm dừng nghỉ cao tốc (Km47+500)',
    position: { x: 14200, y: 0, z: -10600 },
    size: { width: 100, height: 12, depth: 60 }
  },
  {
    id: 'miendong_station',
    type: 'bus_station',
    name: 'Bến xe Miền Đông (Sài Gòn)',
    position: { x: 21000, y: 0, z: -15600 },
    size: { width: 300, height: 25, depth: 200 },
    parkingSlots: 120
  }
];

export function getLandmarks() { return landmarks; }
export function getLandmarkByType(type) { return landmarks.filter(l => l.type === type); }